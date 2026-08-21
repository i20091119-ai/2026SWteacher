/** 공통 유틸 — 응답 포맷, CORS, base64url, 날짜 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = (msg) => new HttpError(400, msg);
export const denied = (msg) => new HttpError(403, msg);
export const missing = (msg) => new HttpError(404, msg);

/**
 * 허용 오리진 판정.
 * ALLOWED_ORIGINS 가 비어있으면 모두 허용(개발 편의), 값이 있으면 정확히 일치하는 것만 허용한다.
 */
export function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const raw = String(env.ALLOWED_ORIGINS || "").trim();
  let allow = "*";
  if (raw) {
    const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
    allow = list.includes(origin) ? origin : list[0];
  } else if (origin) {
    allow = origin;
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(data, request, env, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json;charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

/** 프론트엔드가 기대하는 { ok, data } / { ok:false, error } 봉투 */
export const ok = (data, request, env) => json({ ok: true, data }, request, env);
export const fail = (message, request, env, status = 400) =>
  json({ ok: false, error: message }, request, env, status);

/** ===== base64url ===== */
export function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(bytes) {
  let bin = "";
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const b64urlToText = (s) => new TextDecoder().decode(b64urlToBytes(s));
export const textToB64url = (s) => bytesToB64url(new TextEncoder().encode(s));

/** 타이밍 공격을 피하는 문자열 비교 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** ===== 날짜 ===== */
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function assertYm(ym) {
  const s = String(ym || "");
  if (!YM.test(s)) throw bad(`월 형식이 올바르지 않습니다(YYYY-MM): ${s}`);
  return s;
}
export function assertDate(d) {
  const s = String(d || "");
  if (!DATE.test(s)) throw bad(`날짜 형식이 올바르지 않습니다(YYYY-MM-DD): ${s}`);
  return s;
}
/** 해당 월의 [시작일, 다음달 1일) 범위 — 인덱스를 타는 범위 스캔용 */
export function monthRange(ym) {
  const [y, m] = ym.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return [`${ym}-01`, next];
}
export function prevYm(ym) {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** ===== 값 정규화 ===== */
export function str(v, max = 200) {
  const s = v === undefined || v === null ? "" : String(v);
  return s.length > max ? s.slice(0, max) : s;
}
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
/** 시수: 0 이상, 0.5 단위, 24 이하 */
export function hours(v) {
  const n = num(v);
  if (n < 0) throw bad("시수는 0 이상이어야 합니다");
  if (n > 24) throw bad("시수는 24를 넘을 수 없습니다");
  return Math.round(n * 2) / 2;
}
