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
    assert.deepEqual(d.instructors, ["김경화", "신미정", "이경향", "이수원", "이윤미", "현수진"]);
    assert.equal(d.settings["weeklyCap"], "20");
  });

  test("설정에 holiday.* / admin.whitelist 가 섞여 있지 않다", async () => {
    const d = await must("bootstrap");
    assert.deepEqual(Object.keys(d.settings).sort(), ["weeklyCap"]);
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
    assert.equal(d.instructors.length, 7);
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
    await must("setSetting", { key: "weeklyCap", value: "18" }, { token: adminToken });
    const d = await must("bootstrap");
    assert.equal(d.settings["weeklyCap"], "18");

    for (const key of ["admin.whitelist", "rate.explain"]) {
      const r = await call("setSetting", { key, value: "9" }, { token: adminToken });
      assert.equal(r.ok, false, `${key} 는 설정 API 로 건드릴 수 없어야 한다`);
    }
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
    assert.equal(d.instructors.length, 6);
    assert.equal(d.settings["weeklyCap"], "20");
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

  test("이월 유형 기록도 그대로 받아들인다", async () => {
    const d = await must("importAll", {
      assignments: [{ id: "old1", date: "2026-07-06", kind: "연구이월", name: "김경화", hResearch: 4.5 }],
    }, { token: adminToken });
    assert.deepEqual(d.errors, []);
    const m = await must("getMonth", { ym: "2026-07" });
    assert.equal(m.assignments[0].kind, "연구이월");
  });

  test("폐지된 이월 유형을 새로 만들 수는 없다", async () => {
    const r = await call("saveAssignment",
      { date: "2026-07-06", kind: "연구이월", name: "김경화", hResearch: 3 }, { token: adminToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
  });

  test("폐지된 단가 설정은 오류 없이 그냥 버려진다", async () => {
    const d = await must("importAll", {
      settings: [{ key: "rate.explain", value: "30000" }, { key: "weeklyCap", value: "20" }],
    }, { token: adminToken });
    assert.deepEqual(d.errors, []);
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
    assert.equal(d.instructors.length, 7);   // 파견교사 포함
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

describe("수업 교체", () => {
  const A = { date: "2026-06-13", kind: "해설", form: "주말어드벤처", role: "토오전", name: "김경화", hExplain: 3 };
  let assignmentId, kimToken, leeToken;

  beforeEach(async () => {
    assignmentId = (await must("saveAssignment", A, { token: adminToken })).id;
    kimToken = (await must("loginInstructor", { name: "김경화" })).sessionToken;
    leeToken = (await must("loginInstructor", { name: "이경향" })).sessionToken;
  });

  test("공개 전에는 신청할 수 없다", async () => {
    const r = await call("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    assert.equal(r.ok, false);
    assert.match(r.error, /공개/);
  });

  test("신청 → 승인 시 배치의 담당 강사가 바뀐다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향", note: "개인 사정" }, { token: kimToken });

    let m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.swaps.length, 1);
    assert.equal(m.swaps[0].status, "pending_admin");
    assert.equal(m.assignments[0].name, "김경화", "승인 전에는 그대로");

    await must("approveSwap", { swapId: id }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments[0].name, "이경향");
    assert.equal(m.swaps[0].status, "completed");
  });

  test("거절하면 배치는 그대로다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    await must("rejectSwap", { swapId: id }, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments[0].name, "김경화");
    assert.equal(m.swaps[0].status, "rejected");
  });

  test("남의 배치로는 신청할 수 없다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const r = await call("createSwap", { assignmentId, target: "이수원" }, { token: leeToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });

  test("자기 자신에게는 넘길 수 없다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const r = await call("createSwap", { assignmentId, target: "김경화" }, { token: kimToken });
    assert.equal(r.ok, false);
  });

  test("같은 배치에 두 번 신청할 수 없다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    const r = await call("createSwap", { assignmentId, target: "이수원" }, { token: kimToken });
    assert.equal(r.ok, false);
    assert.match(r.error, /대기 중/);
  });

  test("신청자만 취소할 수 있고, 취소 후에는 다시 신청된다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });

    const nope = await call("cancelSwap", { swapId: id }, { token: leeToken });
    assert.equal(nope.ok, false);

    await must("cancelSwap", { swapId: id }, { token: kimToken });
    await must("createSwap", { assignmentId, target: "이수원" }, { token: kimToken });
  });

  test("신청 뒤 관리자가 담당을 바꿔놨으면 승인이 막힌다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    await must("saveAssignment", { ...A, id: assignmentId, name: "이윤미" }, { token: adminToken });
    const r = await call("approveSwap", { swapId: id }, { token: adminToken });
    assert.equal(r.ok, false);
    assert.match(r.error, /달라졌습니다/);
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments[0].name, "이윤미", "엉뚱한 사람이 밀려나면 안 된다");
  });

  test("이미 끝난 요청은 다시 승인되지 않는다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    await must("approveSwap", { swapId: id }, { token: adminToken });
    const r = await call("approveSwap", { swapId: id }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("강사는 승인할 수 없다", async () => {
    await must("setPublished", { ym: "2026-06", published: true }, { token: adminToken });
    const { id } = await must("createSwap", { assignmentId, target: "이경향" }, { token: kimToken });
    const r = await call("approveSwap", { swapId: id }, { token: kimToken });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe("학생 프로그램", () => {
  const P = { dateStart: "2026-06-09", dateEnd: "2026-06-12", session: "오전", school: "호계초", students: 22 };

  test("추가 → 수정 → 삭제", async () => {
    const { id } = await must("createProgram", P, { token: adminToken });
    let m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.programs.length, 1);
    assert.equal(m.programs[0].school, "호계초");
    assert.equal(m.programs[0].students, 22);

    await must("updateProgram", { ...P, id, students: 25, note: "인원 변경" }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.programs[0].students, 25);
    assert.equal(m.programs[0].note, "인원 변경");

    await must("deleteProgram", { id }, { token: adminToken });
    m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.programs.length, 0);
  });

  test("달을 넘어가는 프로그램은 양쪽 달에 모두 보인다", async () => {
    await must("createProgram",
      { dateStart: "2026-06-29", dateEnd: "2026-07-03", school: "창신중", students: 30 }, { token: adminToken });
    const jun = await must("getMonth", { ym: "2026-06" });
    const jul = await must("getMonth", { ym: "2026-07" });
    assert.equal(jun.programs.length, 1);
    assert.equal(jul.programs.length, 1);
    const may = await must("getMonth", { ym: "2026-05" });
    assert.equal(may.programs.length, 0);
  });

  test("종료일을 생략하면 하루짜리가 된다", async () => {
    await must("createProgram", { dateStart: "2026-06-23", school: "진례초", students: 30 }, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.programs[0].dateEnd, "2026-06-23");
  });

  test("종료일이 시작일보다 빠르면 거부된다", async () => {
    const r = await call("createProgram",
      { dateStart: "2026-06-23", dateEnd: "2026-06-20", school: "진례초" }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("학교 이름 없이는 만들 수 없다", async () => {
    const r = await call("createProgram", { dateStart: "2026-06-23", school: "  " }, { token: adminToken });
    assert.equal(r.ok, false);
  });

  test("강사는 프로그램을 만들 수 없다", async () => {
    const t = (await must("loginInstructor", { name: "김경화" })).sessionToken;
    const r = await call("createProgram", P, { token: t });
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
  });
});

describe("배치 일괄 저장", () => {
  const base = { date: "2026-06-17", kind: "해설", form: "학교체험", hExplain: 4 };

  test("여러 강사를 한 번에 배치한다", async () => {
    const d = await must("saveAssignmentsBatch", {
      assignments: ["김경화", "신미정", "이경향"].map((name) => ({ ...base, name })),
    }, { token: adminToken });
    assert.equal(d.ids.length, 3);
    const m = await must("getMonth", { ym: "2026-06" });
    assert.deepEqual(m.assignments.map((a) => a.name).sort(), ["김경화", "신미정", "이경향"]);
  });

  test("하나라도 잘못되면 아무것도 저장하지 않는다", async () => {
    const r = await call("saveAssignmentsBatch", {
      assignments: [{ ...base, name: "김경화" }, { ...base, name: "없는사람" }],
    }, { token: adminToken });
    assert.equal(r.ok, false);
    const m = await must("getMonth", { ym: "2026-06" });
    assert.equal(m.assignments.length, 0, "부분 저장되면 안 된다");
  });

  test("빈 목록은 거부된다", async () => {
    const r = await call("saveAssignmentsBatch", { assignments: [] }, { token: adminToken });
    assert.equal(r.ok, false);
  });
});

describe("폐지된 이월 기록", () => {
  test("시트에서 넘어온 이월 행은 시수가 그대로 보존된다", async () => {
    await must("importAll", {
      assignments: [{
        id: "old-carry", date: "2026-06-01", kind: "연구이월",
        name: "김경화", hResearch: 3, memo: "5/11 이월분", carry: "TRUE",
      }],
    }, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    const a = m.assignments.find((x) => x.id === "old-carry");
    assert.equal(a.kind, "연구이월");
    assert.equal(a.hResearch, 3);
    assert.equal(a.memo, "5/11 이월분");
    assert.equal(a.carry, undefined, "carry 는 더 이상 API 로 나가지 않는다");
  });
});

describe("월별 주간 상한 (weeklyCap.YYYY-MM)", () => {
  test("특정 달만 다른 상한을 둘 수 있다", async () => {
    await must("setSetting", { key: "weeklyCap.2026-06", value: "14" }, { token: adminToken });
    const d = await must("bootstrap");
    assert.equal(d.settings["weeklyCap.2026-06"], "14");
    assert.equal(d.settings["weeklyCap"], "20", "기본 상한은 그대로");
  });

  test("이관에서도 그대로 받아들인다", async () => {
    const d = await must("importAll", {
      settings: [{ key: "weeklyCap.2026-06", value: "14" }, { key: "weeklyCap", value: "20" }],
    }, { token: adminToken });
    assert.deepEqual(d.errors, [], "월별 상한이 '알 수 없는 키'로 버려지면 안 된다");
    assert.equal(d.counts.settings, 2);
  });

  test("월 형식이 아니면 거부된다", async () => {
    for (const key of ["weeklyCap.2026", "weeklyCap.2026-13", "weeklyCap.전체"]) {
      const r = await call("setSetting", { key, value: "14" }, { token: adminToken });
      assert.equal(r.ok, false, key);
    }
  });
});

describe("시수 입력 — 합계 하나로 받기", () => {
  test("유형에 맞는 칸에 담기고, 합계(hours)로 되돌아온다", async () => {
    const cases = [
      { kind: "해설", hours: 3,   expect: { hExplain: 3, hSupport: 0, hResearch: 0 } },
      { kind: "지원", hours: 2.5, expect: { hExplain: 0, hSupport: 2.5, hResearch: 0 } },
      { kind: "연구", hours: 4,   expect: { hExplain: 0, hSupport: 0, hResearch: 4 } },
    ];
    for (const c of cases) {
      const { id } = await must("saveAssignment",
        { date: "2026-06-10", kind: c.kind, name: "김경화", hours: c.hours }, { token: adminToken });
      const m = await must("getMonth", { ym: "2026-06" });
      const a = m.assignments.find((x) => x.id === id);
      assert.equal(a.hours, c.hours, c.kind);
      assert.equal(a.hExplain, c.expect.hExplain, c.kind);
      assert.equal(a.hSupport, c.expect.hSupport, c.kind);
      assert.equal(a.hResearch, c.expect.hResearch, c.kind);
    }
  });

  test("해설·지원이 나뉜 과거 행은 내역이 보존되고 hours 는 그 합계다", async () => {
    // 주말어드벤처 = 해설 3h + 지원 0.5h 로 저장된 시트 데이터
    await must("saveAssignment", {
      date: "2026-06-13", kind: "해설", form: "주말어드벤처", role: "토오전",
      name: "김경화", hExplain: 3, hSupport: 0.5,
    }, { token: adminToken });
    const m = await must("getMonth", { ym: "2026-06" });
    const a = m.assignments[0];
    assert.equal(a.hExplain, 3);
    assert.equal(a.hSupport, 0.5);
    assert.equal(a.hours, 3.5, "합계는 3.5h");
  });

  test("시수 0 은 거부된다", async () => {
    const r = await call("saveAssignment",
      { date: "2026-06-10", kind: "해설", name: "김경화", hours: 0 }, { token: adminToken });
    assert.equal(r.ok, false);
  });
});
