/**
 * 경남수학문화관 SW해설강사 일정 관리 — Cloudflare Workers + D1 백엔드
 *
 * 프론트엔드 계약은 기존 GAS 와 동일하게 유지한다:
 *   POST { action, payload, auth } → { ok:true, data } | { ok:false, error }
 * 달라진 점은 저장소(구글시트 → D1/SQLite)와, 왕복을 줄인 몇 개의 신규 action 이다.
 */
import { ok, fail, corsHeaders, json, HttpError } from "./util.js";
import { resolveAuth } from "./auth.js";
import * as H from "./handlers.js";

/** 인증이 필요 없는 공개 action */
const PUBLIC_ACTIONS = new Set(["bootstrap", "verifyAdmin", "loginInstructor", "getMonth"]);

async function dispatch(action, p, ctx, db, env) {
  switch (action) {
    /* 조회 */
    case "bootstrap":       return H.bootstrap(db);
    case "getMonth":        return H.getMonth(db, p.ym);
    case "getAdminMonth":   return H.getAdminMonth(db, p.ym);

    /* 로그인 */
    case "loginInstructor": return H.loginInstructor(db, env, p.name);
    case "verifyAdmin":     return H.verifyAdmin(db, env, p.idToken || (p.auth && p.auth.idToken));

    /* 강사 */
    case "saveUnavailable":   return H.saveUnavailable(db, ctx, p);
    case "submitUnavailable": return H.submitUnavailable(db, ctx, p);

    /* 관리자 */
    case "saveAssignment":       return H.saveAssignment(db, ctx, p);
    case "saveAssignmentsBatch": return H.saveAssignmentsBatch(db, ctx, p);
    case "deleteAssignment": return H.deleteAssignment(db, ctx, p);
    case "setSetting":       return H.setSetting(db, ctx, p);
    case "addInstructor":    return H.addInstructor(db, ctx, p);
    case "removeInstructor": return H.removeInstructor(db, ctx, p);
    case "setHoliday":       return H.setHoliday(db, ctx, p);
    case "setPublished":     return H.setPublished(db, ctx, p);

    /* 수업 교체 */
    case "createSwap":       return H.createSwap(db, ctx, p);
    case "cancelSwap":       return H.cancelSwap(db, ctx, p);
    case "approveSwap":      return H.approveSwap(db, ctx, p);
    case "rejectSwap":       return H.rejectSwap(db, ctx, p);

    /* 학생 프로그램 */
    case "createProgram":    return H.createProgram(db, ctx, p);
    case "updateProgram":    return H.updateProgram(db, ctx, p);
    case "deleteProgram":    return H.deleteProgram(db, ctx, p);

    /* 백업 / 마이그레이션 */
    case "exportAll":        return H.exportAll(db, ctx);
    case "importAll":        return H.importAll(db, ctx, p);

    default: throw new HttpError(400, "알 수 없는 action: " + action);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      let dbOk = false;
      let dbError = "";
      try {
        await env.DB.prepare("SELECT 1 AS x").first();
        dbOk = true;
      } catch (e) {
        dbError = String(e && e.message ? e.message : e);
      }
      return json(
        { ok: true, data: { service: "swteacher-api", db: dbOk, dbError, time: new Date().toISOString() } },
        request, env, dbOk ? 200 : 503,
      );
    }

    if (request.method !== "POST") {
      return fail("POST 요청만 처리합니다", request, env, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return fail("요청 본문(JSON)을 해석할 수 없습니다", request, env, 400);
    }

    const action = String((body && body.action) || "");
    const payload = (body && body.payload) || {};
    if (!action) return fail("action 이 없습니다", request, env, 400);
    if (!env.DB) return fail("D1 바인딩(DB)이 설정되지 않았습니다", request, env, 500);

    try {
      const ctx = await resolveAuth(request, env, env.DB, body && body.auth);
      if (!PUBLIC_ACTIONS.has(action) && ctx.role === "guest") {
        return fail("로그인이 필요합니다", request, env, 401);
      }
      const data = await dispatch(action, payload, ctx, env.DB, env);
      return ok(data, request, env);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = String((e && e.message) || e);
      if (status >= 500) console.error(`[${action}]`, e && e.stack ? e.stack : message);
      return fail(message, request, env, status);
    }
  },
};
