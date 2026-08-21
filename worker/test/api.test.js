/** Worker API 통합 테스트 — 실제 SQLite 에 스키마를 올리고 fetch 핸들러를 그대로 호출한다. */
import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import worker from "../src/index.js";
import { issueSession } from "../src/auth.js";
import { FakeD1 } from "./d1-shim.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://i20091119-ai.github.io";

let env;
let adminToken;

function req(action, payload = {}, opts = {}) {
  const headers = { "Content-Type": "application/json", Origin: ORIGIN };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  return new Request("https://api.example/api", {
    method: "POST",
    headers,
    body: JSON.stringify({ action, payload, auth: opts.auth || null }),
  });
}

async function call(action, payload, opts) {
  const res = await worker.fetch(req(action, payload, opts), env);
  const body = await res.json();
  return { status: res.status, ...body };
}
async function must(action, payload, opts) {
  const r = await call(action, payload, opts);
  assert.equal(r.ok, true, `${action} 실패: ${r.error}`);
  return r.data;
}

before(async () => {
  env = {
    DB: null,
    SESSION_SECRET: "test-secret-0123456789",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    ALLOWED_ORIGINS: ORIGIN,
  };
});

beforeEach(async () => {
  const db = new FakeD1();
  db.loadFile(join(ROOT, "schema.sql"));
  db.loadFile(join(ROOT, "seed.sql"));
  env.DB = db;
  adminToken = (await issueSession(env, { role: "admin", email: "i20091119@gmail.com" })).token;
});

describe("헬스체크 / CORS", () => {
  test("GET /health 는 DB 연결까지 확인한다", async () => {
    const res = await worker.fetch(new Request("https://api.example/health", { headers: { Origin: ORIGIN } }), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.db, true);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  });

  test("OPTIONS 프리플라이트에 CORS 헤더를 준다", async () => {
    const res = await worker.fetch(
      new Request("https://api.example/api", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  });

  test("허용 목록에 없는 오리진은 반사하지 않는다", async () => {
    const res = await worker.fetch(
      new Request("https://api.example/health", { headers: { Origin: "https://evil.example" } }), env);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  });
});

describe("bootstrap", () => {
  test("강사 5명을 가나다순으로 준다", async () => {
    const d = await must("bootstrap");
    assert.deepEqual(d.instructors, ["김경화", "신미정", "이경향", "이수원", "이윤미"]);
    assert.equal(d.settings["rate.explain"], "30000");
    assert.equal(d.settings["weeklyCap"], "14");
  });

  test("설정에 holiday.* / admin.whitelist 가 섞여 있지 않다", async () => {
    const d = await must("bootstrap");
    assert.deepEqual(Object.keys(d.settings).sort(), ["rate.explain", "rate.other", "weeklyCap"]);
  });
});

describe("강사 인증", () => {
  test("명단에 있는 이름은 세션 토큰을 받는다", async () => {
    const d = await must("loginInstructor", { name: "신미정" });
    assert.equal(d.name, "신미정");
    assert.ok(d.sessionToken);
  });

  test("명단에 없는 이름은 거부된다", async () => {
    const r = await call("loginInstructor", { name: "홍길동" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  test("이름만 주장해도 명단에 없으면 쓰기가 막힌다", async () => {
    const r = await call("saveUnavailable", { date: "2026-06-10", on: true },
      { auth: { role: "instructor", name: "침입자" } });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  test("위조한 세션 토큰은 통하지 않는다", async () => {
    const forged = (await issueSession({ SESSION_SECRET: "wrong-secret" },
      { role: "admin", email: "i20091119@gmail.com" })).token;
    const r = await call("saveAssignment", { date: "2026-06-06", name: "김경화", kind: "해설", hExplain: 3 },
      { token: forged });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });

  test("만료된 세션 토큰은 통하지 않는다", async () => {
    const realNow = Date.now;
    Date.now = () => realNow() - 13 * 60 * 60 * 1000; // 13시간 전에 발급
    const old = (await issueSession(env, { role: "admin", email: "i20091119@gmail.com" })).token;
    Date.now = realNow;
    const r = await call("exportAll", {}, { token: old });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });

  test("화이트리스트에서 빠진 관리자는 기존 토큰으로도 못 들어온다", async () => {
    env.DB.prepare("DELETE FROM admins WHERE email = ?").bind("i20091119@gmail.com").run();
    const r = await call("exportAll", {}, { token: adminToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe("근무불가일", () => {
  let insToken;
  beforeEach(async () => {
    insToken = (await must("loginInstructor", { name: "이윤미" })).sessionToken;
  });

  test("등록 → 조회 → 해제", async () => {
    await must("saveUnavailable", { date: "2026-06-13", on: true, reason: "가족 일정" }, { token: insToken });
    let m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.unavails, [{ name: "이윤미", date: "2026-06-13", reason: "가족 일정" }]);

    await must("saveUnavailable", { date: "2026-06-13", on: false }, { token: insToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.unavails.length, 0);
  });

  test("같은 날 다시 등록해도 행이 늘어나지 않는다 (자연키 UPSERT)", async () => {
    await must("saveUnavailable", { date: "2026-06-13", on: true, reason: "A" }, { token: insToken });
    await must("saveUnavailable", { date: "2026-06-13", on: true, reason: "B" }, { token: insToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.unavails.length, 1);
    assert.equal(m.unavails[0].reason, "B");
  });

  test("불가일을 고치면 그 달 제출 상태가 자동 해제된다", async () => {
    await must("submitUnavailable", { ym: "2026-06", submitted: true }, { token: insToken });
    let m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.submits.find((s) => s.name === "이윤미").submitted, true);

    await must("saveUnavailable", { date: "2026-06-20", on: true }, { token: insToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.submits.find((s) => s.name === "이윤미").submitted, false);
  });

  test("다른 강사 이름으로 대신 저장할 수 없다", async () => {
    await must("saveUnavailable", { date: "2026-06-13", on: true, name: "김경화" }, { token: insToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.unavails[0].name, "이윤미"); // payload 의 name 은 무시된다
  });

  test("잘못된 날짜 형식은 거부된다", async () => {
    const r = await call("saveUnavailable", { date: "2026-6-1", on: true }, { token: insToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("강사는 배치를 만들 수 없다", async () => {
    const r = await call("saveAssignment", { date: "2026-06-06", name: "이윤미", kind: "해설", hExplain: 3 },
      { token: insToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe("배치(일정)", () => {
  const A = { date: "2026-06-06", kind: "해설", form: "가족체험", role: "주", name: "김경화", hExplain: 3 };

  test("생성 → 수정 → 삭제", async () => {
    const { id } = await must("saveAssignment", A, { token: adminToken });
    assert.ok(id);

    let m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 1);
    assert.equal(m.assignments[0].hExplain, 3);

    await must("saveAssignment", { ...A, id, hExplain: 4, memo: "연장" }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments[0].hExplain, 4);
    assert.equal(m.assignments[0].memo, "연장");

    await must("deleteAssignment", { id }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 0);
  });

  test("없는 id 수정/삭제는 404", async () => {
    const u = await call("saveAssignment", { ...A, id: "no-such-id" }, { token: adminToken });
    assert.equal(u.status, 404);
    const d = await call("deleteAssignment", { id: "no-such-id" }, { token: adminToken });
    assert.equal(d.status, 404);
  });

  test("월 경계가 정확하다 — 12월 조회에 1월 데이터가 섞이지 않는다", async () => {
    await must("saveAssignment", { ...A, date: "2026-12-31" }, { token: adminToken });
    await must("saveAssignment", { ...A, date: "2027-01-01" }, { token: adminToken });
    const dec = await must("getMonth", { ym: "2026-12" });
    assert.deepEqual(dec.assignments.map((x) => x.date), ["2026-12-31"]);
  });

  test("알 수 없는 유형/형태/역할은 거부된다", async () => {
    for (const patch of [{ kind: "야근" }, { form: "온라인" }, { role: "감독" }]) {
      const r = await call("saveAssignment", { ...A, ...patch }, { token: adminToken });
      assert.equal(r.ok, false, JSON.stringify(patch));
      assert.equal(r.status, 400);
    }
  });

  test("명단에 없는 이름으로는 배치할 수 없다", async () => {
    const r = await call("saveAssignment", { ...A, name: "홍길동" }, { token: adminToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("시수 0 짜리 배치는 거부된다", async () => {
    const r = await call("saveAssignment", { ...A, hExplain: 0 }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("시수는 0.5 단위로 반올림된다", async () => {
    await must("saveAssignment", { ...A, hExplain: 3.3 }, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments[0].hExplain, 3.5);
  });
});

describe("강사 관리", () => {
  test("추가하면 명단과 순번에 즉시 들어간다", async () => {
    await must("addInstructor", { name: "박서준" }, { token: adminToken });
    const d = await must("bootstrap");
    assert.ok(d.instructors.includes("박서준"));
    assert.equal(d.instructors.length, 6);
  });

  test("중복 추가는 거부된다", async () => {
    const r = await call("addInstructor", { name: "김경화" }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("삭제는 소프트 삭제 — 과거 배치 기록이 살아있다", async () => {
    const { id } = await must("saveAssignment",
      { date: "2026-06-06", kind: "해설", name: "이수원", hExplain: 3 }, { token: adminToken });
    await must("removeInstructor", { name: "이수원" }, { token: adminToken });

    const d = await must("bootstrap");
    assert.equal(d.instructors.includes("이수원"), false, "명단에서는 빠져야 한다");

    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.find((a) => a.id === id).name, "이수원", "지난 배치는 남아야 한다");
  });

  test("이미 삭제된 강사를 또 삭제하면 404", async () => {
    await must("removeInstructor", { name: "이수원" }, { token: adminToken });
    const r = await call("removeInstructor", { name: "이수원" }, { token: adminToken });
    assert.equal(r.status, 404);
  });
});

describe("설정 / 휴관일 / 공개", () => {
  test("허용된 설정만 바꿀 수 있다", async () => {
    await must("setSetting", { key: "rate.explain", value: "32000" }, { token: adminToken });
    const d = await must("bootstrap");
    assert.equal(d.settings["rate.explain"], "32000");

    const r = await call("setSetting", { key: "admin.whitelist", value: "hacker@example.com" },
      { token: adminToken });
    assert.equal(r.ok, false, "화이트리스트를 설정 API 로 건드릴 수 없어야 한다");
  });

  test("숫자가 아닌 설정 값은 거부된다", async () => {
    const r = await call("setSetting", { key: "weeklyCap", value: "많이" }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("2026년 공휴일이 월별로 내려온다", async () => {
    const m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.holidays, ["2026-06-06"]);
  });

  test("휴관일 추가/제거", async () => {
    await must("setHoliday", { date: "2026-06-15", on: true, label: "임시휴관" }, { token: adminToken });
    let m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.holidays, ["2026-06-06", "2026-06-15"]);

    await must("setHoliday", { date: "2026-06-06", on: false }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.holidays, ["2026-06-15"]);
  });

  test("확정 공개 토글", async () => {
    let m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.published, false);
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.published, true);
  });
});

describe("getAdminMonth — 왕복 1회", () => {
  test("당월 배치와 명단·설정을 한 번에 준다", async () => {
    await must("saveAssignment",
      { date: "2026-05-30", kind: "해설", name: "김경화", hExplain: 8 }, { token: adminToken });
    await must("saveAssignment",
      { date: "2026-06-06", kind: "해설", name: "신미정", hExplain: 3 }, { token: adminToken });

    const d = await must("getAdminMonth", { ym: "2026-06" }, { token: adminToken });
    assert.equal(d.ym, "2026-06");
    assert.deepEqual(d.assignments.map((a) => a.date), ["2026-06-06"]);
    assert.equal(d.instructors.length, 5);
    assert.equal(d.settings["weeklyCap"], "14");
  });

  test("관리자가 아니면 막힌다", async () => {
    const r = await call("getAdminMonth", { ym: "2026-06" });
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });
});

describe("입력 검증", () => {
  test("잘못된 월 형식은 400", async () => {
    for (const ym of ["2026-13", "26-06", "2026/06", ""]) {
      const r = await call("getMonth", { ym });
      assert.equal(r.ok, false, ym);
      assert.equal(r.status, 400);
    }
  });

  test("알 수 없는 action 은 400", async () => {
    const r = await call("dropDatabase", {}, { token: adminToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("깨진 JSON 본문은 400", async () => {
    const res = await worker.fetch(new Request("https://api.example/api", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: "{oops",
    }), env);
    assert.equal(res.status, 400);
  });
});

describe("마이그레이션 (importAll)", () => {
  const SHEET = {
    instructors: [{ name: "김경화", order: 1 }, { name: "이상우", order: 99, active: 0 }],
    unavailable: [{ name: "이윤미", date: "2026-06-13", reason: "가족 일정" }],
    submissions: [{ ym: "2026-06", name: "신미정", submitted: "TRUE", submittedAt: "2026-05-25T12:30:00Z" }],
    assignments: [
      { id: "u1", date: "2026-06-06", kind: "해설", form: "가족체험", role: "주", name: "이상우", hExplain: 3 },
      { id: "u2", date: "2026-06-06", kind: "해설", form: "가족체험", role: "보조", name: "김경화", hExplain: 3 },
    ],
    settings: [
      { key: "rate.explain", value: "30000" },
      { key: "holiday.2026-07-17", value: "1" },
      { key: "publish.2026-06", value: "1" },
      { key: "admin.whitelist", value: "i20091119@gmail.com, second@example.com" },
    ],
  };

  test("dryRun 은 세어만 보고 아무것도 쓰지 않는다", async () => {
    const d = await must("importAll", { ...SHEET, dryRun: true }, { token: adminToken });
    assert.equal(d.dryRun, true);
    assert.equal(d.counts.assignments, 2);
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 0);
  });

  test("시트 데이터를 통째로 적재한다", async () => {
    const d = await must("importAll", SHEET, { token: adminToken });
    assert.deepEqual(d.errors, []);

    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 2);
    assert.equal(m.unavails.length, 1);
    assert.equal(m.submits[0].submitted, true, "시트의 'TRUE' 문자열이 참으로 들어가야 한다");
    assert.equal(m.published, true, "publish.2026-06 이 months 테이블로 옮겨져야 한다");

    const jul = await must("getMonth", { ym: "2026-07" });
    assert.deepEqual(jul.holidays, ["2026-07-17"], "holiday.* 가 holidays 테이블로 옮겨져야 한다");
  });

  test("폐지된 이월 유형도 과거 기록은 그대로 받아들인다", async () => {
    const d = await must("importAll", {
      assignments: [{ id: "old1", date: "2026-07-06", kind: "연구이월", name: "김경화", hResearch: 4.5 }],
    }, { token: adminToken });
    assert.deepEqual(d.errors, []);
    const m = await must("getMonth", { ym: "2026-07" });
    assert.equal(m.assignments[0].kind, "연구이월");
  });

  test("이월 유형을 새로 만들 수는 없다", async () => {
    const r = await call("saveAssignment",
      { date: "2026-07-06", kind: "연구이월", name: "김경화", hResearch: 3 }, { token: adminToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("admin.whitelist 쉼표 목록이 admins 테이블로 흩어진다", async () => {
    await must("importAll", SHEET, { token: adminToken });
    const r = await env.DB.prepare("SELECT email FROM admins ORDER BY email").all();
    assert.deepEqual(r.results.map((x) => x.email), ["i20091119@gmail.com", "second@example.com"]);
  });

  test("파견교사(이상우)는 순번 명단에서 빠지되 배치는 가능하다", async () => {
    await must("importAll", SHEET, { token: adminToken });
    const d = await must("bootstrap");
    assert.equal(d.instructors.includes("이상우"), false);
    assert.equal(d.assignableNames.includes("이상우"), true);
    await must("saveAssignment",
      { date: "2026-08-01", kind: "해설", name: "이상우", hExplain: 3 }, { token: adminToken });
  });

  test("두 번 돌려도 결과가 같다 (멱등)", async () => {
    await must("importAll", SHEET, { token: adminToken });
    await must("importAll", SHEET, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 2, "중복 적재되면 안 된다");
    assert.equal(m.unavails.length, 1);
  });

  test("깨진 행은 건너뛰고 나머지는 들어간다", async () => {
    const d = await must("importAll", {
      assignments: [
        { id: "good", date: "2026-06-06", kind: "해설", name: "김경화", hExplain: 3 },
        { id: "bad1", date: "6월 6일", kind: "해설", name: "김경화", hExplain: 3 },
        { id: "bad2", date: "2026-06-07", kind: "낮잠", name: "김경화", hExplain: 3 },
      ],
    }, { token: adminToken });
    assert.equal(d.counts.assignments, 1);
    assert.equal(d.errors.length, 2);
    const m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.assignments.map((a) => a.id), ["good"]);
  });

  test("관리자가 아니면 적재할 수 없다", async () => {
    const r = await call("importAll", SHEET);
    assert.equal(r.ok, false);
    assert.equal(r.status, 401);
  });
});

describe("exportAll — 백업", () => {
  test("모든 테이블을 되돌려준다", async () => {
    await must("saveAssignment",
      { date: "2026-06-06", kind: "해설", name: "김경화", hExplain: 3 }, { token: adminToken });
    const d = await must("exportAll", {}, { token: adminToken });
    assert.equal(d.instructors.length, 5);
    assert.equal(d.assignments.length, 1);
    assert.equal(d.holidays.length, 20);
    assert.ok(d.exportedAt);
  });
});

describe("감사 로그", () => {
  test("누가 무엇을 바꿨는지 기록된다", async () => {
    await must("saveAssignment",
      { date: "2026-06-06", kind: "해설", name: "김경화", hExplain: 3 }, { token: adminToken });
    const r = await env.DB.prepare("SELECT * FROM audit_log ORDER BY id").all();
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].actor, "i20091119@gmail.com");
    assert.equal(r.results[0].action, "assignment.create");
  });
});
