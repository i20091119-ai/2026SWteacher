/**
 * 로컬 미리보기 서버.
 * 정적 파일(index.html/css/js)과 함께, 워커 소스를 그대로 쓰는 API 를 메모리 SQLite 위에 올린다.
 * Cloudflare 에 배포하지 않고도 화면과 동작을 확인할 수 있다.
 *
 *   node tools/dev-server.mjs [포트]
 *   → http://localhost:8787
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../worker/src/index.js";
import { FakeD1 } from "../worker/test/d1-shim.js";
import { issueSession } from "../worker/src/auth.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8787);

const db = new FakeD1();
db.loadFile(join(ROOT, "worker/schema.sql"));
db.loadFile(join(ROOT, "worker/seed.sql"));

const env = {
  DB: db,
  SESSION_SECRET: "local-dev-secret",
  GOOGLE_CLIENT_ID: "local-dev-client-id",
  ALLOWED_ORIGINS: "",
};

const MIME = {
  ".html": "text/html;charset=utf-8", ".css": "text/css;charset=utf-8",
  ".js": "text/javascript;charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon",
};

/** 로그인 없이 관리자 화면을 열어보기 위한 개발용 토큰 */
async function devToken(role) {
  return role === "admin"
    ? (await issueSession(env, { role: "admin", email: "i20091119@gmail.com" })).token
    : (await issueSession(env, { role: "instructor", name: "김경화" })).token;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/__devtoken") {
    const t = await devToken(url.searchParams.get("role") || "admin");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ token: t }));
  }

  if (url.pathname === "/api" || url.pathname === "/health") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`https://local${url.pathname}`, {
      method: req.method,
      headers: req.headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }

  const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const buf = await readFile(join(ROOT, rel));
    res.writeHead(200, { "Content-Type": MIME[extname(rel)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain;charset=utf-8" });
    res.end("not found: " + rel);
  }
});

server.listen(PORT, () => console.log(`dev server: http://localhost:${PORT}`));
