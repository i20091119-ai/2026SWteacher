/**
 * 인증
 *  - 관리자: Google ID 토큰(JWT)을 워커에서 직접 서명 검증(RS256 + JWKS 캐시)한 뒤,
 *    자체 세션 토큰(HMAC-SHA256)을 발급한다. 이후 요청은 네트워크 왕복 없이 로컬 검증만 한다.
 *    (기존 GAS는 요청마다 oauth2.googleapis.com/tokeninfo 로 왕복했다.)
 *  - 강사: 이름 기반. 명단에 실제로 존재하는 이름인지 서버에서 확인한다.
 */
import { HttpError, denied, bad, b64urlToBytes, b64urlToText, bytesToB64url, textToB64url, timingSafeEqual } from "./util.js";

const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISS = ["accounts.google.com", "https://accounts.google.com"];
const SESSION_TTL_SEC = 12 * 60 * 60; // 12시간

/** 아이솔레이트 수명 동안 JWKS 를 재사용한다. */
let jwksCache = { at: 0, keys: null };

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(JWKS_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new HttpError(502, "Google 공개키를 가져오지 못했습니다");
  const body = await res.json();
  jwksCache = { at: now, keys: body.keys || [] };
  return jwksCache.keys;
}

/** Google ID 토큰을 검증하고 이메일을 돌려준다. */
export async function verifyGoogleIdToken(idToken, clientId) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw denied("ID 토큰 형식이 올바르지 않습니다");
  const [h, p, s] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToText(h));
    payload = JSON.parse(b64urlToText(p));
  } catch {
    throw denied("ID 토큰을 해석할 수 없습니다");
  }
  if (header.alg !== "RS256") throw denied("지원하지 않는 서명 알고리즘: " + header.alg);

  const keys = await getJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw denied("일치하는 Google 공개키가 없습니다 (키 회전 직후일 수 있습니다)");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) throw denied("ID 토큰 서명 검증 실패");

  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp) <= now) throw denied("ID 토큰이 만료되었습니다. 다시 로그인하세요.");
  if (Number(payload.iat) > now + 300) throw denied("ID 토큰 발급 시각이 올바르지 않습니다");
  if (!GOOGLE_ISS.includes(String(payload.iss))) throw denied("발급자가 Google이 아닙니다");
  if (String(payload.aud) !== String(clientId)) throw denied("OAuth 클라이언트 ID가 일치하지 않습니다");
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw denied("이메일이 인증되지 않은 계정입니다");
  }
  if (!payload.email) throw denied("ID 토큰에 이메일이 없습니다");
  return String(payload.email).toLowerCase();
}

/** ===== 자체 세션 토큰 ===== */
async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function issueSession(env, claims) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new HttpError(500, "SESSION_SECRET 이 설정되지 않았습니다");
  const body = { ...claims, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const payload = textToB64url(JSON.stringify(body));
  const key = await hmacKey(secret);
  const sig = bytesToB64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  return { token: `${payload}.${sig}`, expiresAt: new Date(body.exp * 1000).toISOString() };
}

export async function readSession(env, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const secret = env.SESSION_SECRET;
  if (!secret) return null;
  const key = await hmacKey(secret);
  const expect = bytesToB64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  if (!timingSafeEqual(sig, expect)) return null;
  let body;
  try {
    body = JSON.parse(b64urlToText(payload));
  } catch {
    return null;
  }
  if (Number(body.exp) <= Math.floor(Date.now() / 1000)) return null;
  return body;
}

/**
 * 요청의 인증 컨텍스트를 확정한다.
 * body.auth = { role, name?, sessionToken? } / Authorization: Bearer <sessionToken>
 */
export async function resolveAuth(request, env, db, auth) {
  const header = request.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const token = bearer || (auth && auth.sessionToken) || "";

  if (token) {
    const s = await readSession(env, token);
    if (s && s.role === "admin" && s.email) {
      // 세션 발급 이후 화이트리스트에서 제거됐을 수 있으므로 매번 확인한다.
      const row = await db.prepare("SELECT email FROM admins WHERE email = ?").bind(s.email).first();
      if (!row) throw denied("관리자 권한이 해제되었습니다");
      return { role: "admin", email: s.email };
    }
    if (s && s.role === "instructor" && s.name) {
      return { role: "instructor", name: s.name };
    }
  }

  if (auth && auth.role === "instructor" && auth.name) {
    const name = String(auth.name).trim();
    const row = await db.prepare("SELECT name FROM instructors WHERE name = ? AND active = 1").bind(name).first();
    if (!row) throw denied("등록되지 않은 강사입니다: " + name);
    return { role: "instructor", name };
  }

  return { role: "guest" };
}

export function requireAdmin(ctx) {
  if (ctx.role !== "admin") throw denied("관리자 인증이 필요합니다");
  return ctx;
}
export function requireInstructor(ctx) {
  if (ctx.role !== "instructor") throw denied("강사 인증이 필요합니다");
  return ctx;
}
export { bad };
