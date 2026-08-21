/**
 * 데이터 핸들러 — 전부 인덱스를 타는 SQL 한 방으로 끝낸다.
 * 시트 백엔드의 "전체 읽기 → 자바스크립트 필터 → 행 번호 찾아 쓰기" 패턴은 모두 제거됐다.
 */
import {
  bad, denied, missing, assertYm, assertDate, monthRange, nowIso, str, num, hours,
} from "./util.js";
import { verifyGoogleIdToken, issueSession, requireAdmin, requireInstructor } from "./auth.js";

// 새로 만들 수 있는 유형. (이월 기능은 폐지됐고, 과거 기록만 LEGACY_KINDS 로 남는다)
const KINDS = ["해설", "연구", "지원"];
const LEGACY_KINDS = ["연구이월", "지원이월"];
const ALL_KINDS = KINDS.concat(LEGACY_KINDS);
const FORMS = ["", "학교체험", "가족체험", "주말어드벤처"];
const ROLES = ["", "주", "보조", "토오전", "토오후", "일오전"];

/** ===== 행 매핑 (snake_case DB → camelCase 프론트엔드) ===== */
const mapAssignment = (r) => ({
  id: r.id,
  date: r.date,
  kind: r.kind,
  form: r.form || "",
  role: r.role || "",
  name: r.name,
  hExplain: num(r.h_explain),
  hSupport: num(r.h_support),
  hResearch: num(r.h_research),
  memo: r.memo || "",
});
const mapUnavail = (r) => ({ name: r.name, date: r.date, reason: r.reason || "" });
const mapSubmit = (r) => ({
  ym: r.ym, name: r.name, submitted: !!r.submitted, submittedAt: r.submitted_at || "",
});

const rows = (result) => (result && result.results) || [];

/** 감사 로그 — 실패해도 본 요청을 막지 않는다. */
async function audit(db, ctx, action, detail) {
  try {
    await db
      .prepare("INSERT INTO audit_log (at, actor, role, action, detail) VALUES (?, ?, ?, ?, ?)")
      .bind(nowIso(), ctx.email || ctx.name || "", ctx.role, action, str(detail, 500))
      .run();
  } catch { /* 로깅 실패는 무시 */ }
}

/** ===== 조회 ===== */

async function readSettings(db) {
  const r = await db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  rows(r).forEach((x) => { out[x.key] = x.value; });
  return out;
}

export async function bootstrap(db) {
  const [ins, all, set] = await db.batch([
    db.prepare("SELECT name FROM instructors WHERE active = 1 ORDER BY name COLLATE NOCASE"),
    db.prepare("SELECT name FROM instructors ORDER BY active DESC, sort_order, name"),
    db.prepare("SELECT key, value FROM settings"),
  ]);
  const settings = {};
  rows(set).forEach((x) => { settings[x.key] = x.value; });
  return {
    // 순번 계산의 기준이 되는 가나다순은 서버에서 확정해 내려준다.
    instructors: rows(ins).map((x) => x.name).sort((a, b) => a.localeCompare(b, "ko")),
    // 배치 시 선택 가능한 전체 이름 (순번에 넣지 않는 파견교사 포함)
    assignableNames: rows(all).map((x) => x.name),
    settings,
  };
}

/** 한 달치 데이터 — 5개 쿼리를 D1 배치 한 번으로 처리한다. */
export async function getMonth(db, ymRaw) {
  const ym = assertYm(ymRaw);
  const [from, to] = monthRange(ym);
  const [a, u, s, h, m] = await db.batch([
    db.prepare("SELECT * FROM assignments WHERE date >= ? AND date < ? ORDER BY date, form, role").bind(from, to),
    db.prepare("SELECT * FROM unavailable WHERE date >= ? AND date < ? ORDER BY date, name").bind(from, to),
    db.prepare("SELECT * FROM submissions WHERE ym = ?").bind(ym),
    db.prepare("SELECT date FROM holidays WHERE date >= ? AND date < ? ORDER BY date").bind(from, to),
    db.prepare("SELECT published FROM months WHERE ym = ?").bind(ym),
  ]);
  return {
    ym,
    assignments: rows(a).map(mapAssignment),
    unavails: rows(u).map(mapUnavail),
    submits: rows(s).map(mapSubmit),
    holidays: rows(h).map((x) => x.date),
    published: !!(rows(m)[0] && rows(m)[0].published),
  };
}

/**
 * 관리자 화면 전용 — 당월 + 전월 배치 + 이월 + 명단 + 설정을 한 번에.
 * 기존에는 getMonth 를 두 번(당월/전월) 호출해 왕복이 두 배였다.
 */
export async function getAdminMonth(db, ymRaw) {
  const ym = assertYm(ymRaw);
  const [from, to] = monthRange(ym);
  const [a, u, s, h, m, ins, all, set] = await db.batch([
    db.prepare("SELECT * FROM assignments WHERE date >= ? AND date < ? ORDER BY date, form, role").bind(from, to),
    db.prepare("SELECT * FROM unavailable WHERE date >= ? AND date < ? ORDER BY date, name").bind(from, to),
    db.prepare("SELECT * FROM submissions WHERE ym = ?").bind(ym),
    db.prepare("SELECT date FROM holidays WHERE date >= ? AND date < ? ORDER BY date").bind(from, to),
    db.prepare("SELECT published FROM months WHERE ym = ?").bind(ym),
    db.prepare("SELECT name FROM instructors WHERE active = 1 ORDER BY name COLLATE NOCASE"),
    db.prepare("SELECT name FROM instructors ORDER BY active DESC, sort_order, name"),
    db.prepare("SELECT key, value FROM settings"),
  ]);
  const settings = {};
  rows(set).forEach((x) => { settings[x.key] = x.value; });
  return {
    ym,
    assignments: rows(a).map(mapAssignment),
    unavails: rows(u).map(mapUnavail),
    submits: rows(s).map(mapSubmit),
    holidays: rows(h).map((x) => x.date),
    published: !!(rows(m)[0] && rows(m)[0].published),
    instructors: rows(ins).map((x) => x.name).sort((a2, b2) => a2.localeCompare(b2, "ko")),
    assignableNames: rows(all).map((x) => x.name),
    settings,
  };
}

/** ===== 로그인 ===== */

export async function loginInstructor(db, env, nameRaw) {
  const name = str(nameRaw, 50).trim();
  if (!name) throw bad("이름이 비어있습니다");
  const row = await db
    .prepare("SELECT name FROM instructors WHERE name = ? AND active = 1")
    .bind(name).first();
  if (!row) throw denied("등록되지 않은 강사입니다: " + name);
  const { token, expiresAt } = await issueSession(env, { role: "instructor", name });
  return { name, sessionToken: token, expiresAt };
}

export async function verifyAdmin(db, env, idToken) {
  if (!env.GOOGLE_CLIENT_ID) throw bad("GOOGLE_CLIENT_ID 가 설정되지 않았습니다");
  const email = await verifyGoogleIdToken(idToken, env.GOOGLE_CLIENT_ID);
  const row = await db.prepare("SELECT email FROM admins WHERE email = ?").bind(email).first();
  if (!row) throw denied(`관리자 권한이 없는 계정입니다: ${email}`);
  const { token, expiresAt } = await issueSession(env, { role: "admin", email });
  return { email, sessionToken: token, expiresAt };
}

/** ===== 강사 쓰기 ===== */

export async function saveUnavailable(db, ctx, p) {
  requireInstructor(ctx);
  const date = assertDate(p.date);
  const ym = date.slice(0, 7);
  const reason = str(p.reason, 200);
  const stmts = p.on
    ? [db.prepare(
        `INSERT INTO unavailable (name, date, reason, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(name, date) DO UPDATE SET reason = excluded.reason, updated_at = excluded.updated_at`,
      ).bind(ctx.name, date, reason, nowIso())]
    : [db.prepare("DELETE FROM unavailable WHERE name = ? AND date = ?").bind(ctx.name, date)];
  // 불가일을 고치면 그 달 제출 상태는 자동 해제된다.
  stmts.push(
    db.prepare(
      `INSERT INTO submissions (ym, name, submitted, submitted_at) VALUES (?, ?, 0, '')
       ON CONFLICT(ym, name) DO UPDATE SET submitted = 0, submitted_at = ''`,
    ).bind(ym, ctx.name),
  );
  await db.batch(stmts);
  await audit(db, ctx, p.on ? "unavailable.set" : "unavailable.clear", date);
  return { ok: true, date, on: !!p.on };
}

export async function submitUnavailable(db, ctx, p) {
  requireInstructor(ctx);
  const ym = assertYm(p.ym);
  const submitted = p.submitted ? 1 : 0;
  const at = submitted ? nowIso() : "";
  await db.prepare(
    `INSERT INTO submissions (ym, name, submitted, submitted_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ym, name) DO UPDATE SET submitted = excluded.submitted, submitted_at = excluded.submitted_at`,
  ).bind(ym, ctx.name, submitted, at).run();
  await audit(db, ctx, "submission.set", `${ym}=${submitted}`);
  return { ok: true, ym, submitted: !!submitted, submittedAt: at };
}

/** ===== 관리자 쓰기 ===== */

async function assertAssignable(db, name) {
  const row = await db.prepare("SELECT name FROM instructors WHERE name = ?").bind(name).first();
  if (!row) throw bad(`명단에 없는 이름입니다: ${name}`);
}

export async function saveAssignment(db, ctx, p) {
  requireAdmin(ctx);
  const date = assertDate(p.date);
  const name = str(p.name, 50).trim();
  const kind = str(p.kind, 20);
  const form = str(p.form, 20);
  const role = str(p.role, 20);
  if (!name) throw bad("강사를 선택하세요");
  if (!KINDS.includes(kind)) throw bad(`유형이 올바르지 않습니다: ${kind}`);
  if (!FORMS.includes(form)) throw bad(`형태가 올바르지 않습니다: ${form}`);
  if (!ROLES.includes(role)) throw bad(`역할이 올바르지 않습니다: ${role}`);
  await assertAssignable(db, name);

  const hE = hours(p.hExplain);
  const hS = hours(p.hSupport);
  const hR = hours(p.hResearch);
  if (hE + hS + hR <= 0) throw bad("시수를 하나 이상 입력하세요");
  const memo = str(p.memo, 500);

  if (p.id) {
    const id = str(p.id, 64);
    const res = await db.prepare(
      `UPDATE assignments SET date=?, kind=?, form=?, role=?, name=?,
         h_explain=?, h_support=?, h_research=?, memo=?, updated_at=?
       WHERE id = ?`,
    ).bind(date, kind, form, role, name, hE, hS, hR, memo, nowIso(), id).run();
    if (!res.meta || res.meta.changes === 0) throw missing("배치를 찾을 수 없습니다: " + id);
    await audit(db, ctx, "assignment.update", `${id} ${date} ${name}`);
    return { id };
  }
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO assignments (id, date, kind, form, role, name, h_explain, h_support, h_research, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, date, kind, form, role, name, hE, hS, hR, memo).run();
  await audit(db, ctx, "assignment.create", `${id} ${date} ${name}`);
  return { id };
}

export async function deleteAssignment(db, ctx, p) {
  requireAdmin(ctx);
  const id = str(p.id, 64);
  const res = await db.prepare("DELETE FROM assignments WHERE id = ?").bind(id).run();
  if (!res.meta || res.meta.changes === 0) throw missing("배치를 찾을 수 없습니다");
  await audit(db, ctx, "assignment.delete", id);
  return { ok: true };
}

const ALLOWED_SETTINGS = ["rate.explain", "rate.other", "weeklyCap"];

export async function setSetting(db, ctx, p) {
  requireAdmin(ctx);
  const key = str(p.key, 60);
  if (!ALLOWED_SETTINGS.includes(key)) throw bad(`수정할 수 없는 설정 키입니다: ${key}`);
  const value = str(p.value, 200);
  if (!/^\d+(\.\d+)?$/.test(value)) throw bad("설정 값은 숫자여야 합니다");
  await db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).bind(key, value, nowIso()).run();
  await audit(db, ctx, "setting.set", `${key}=${value}`);
  return { ok: true };
}

export async function addInstructor(db, ctx, p) {
  requireAdmin(ctx);
  const name = str(p.name, 50).trim();
  if (!name) throw bad("이름이 비어있습니다");
  const dup = await db.prepare("SELECT name FROM instructors WHERE name = ?").bind(name).first();
  if (dup) throw bad("이미 등록된 강사입니다: " + name);
  const max = await db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM instructors").first();
  await db.prepare("INSERT INTO instructors (name, sort_order, active) VALUES (?, ?, 1)")
    .bind(name, num(max && max.m) + 1).run();
  await audit(db, ctx, "instructor.add", name);
  return { name };
}

/**
 * 강사 삭제 — 과거 배치/불가일 기록은 보존해야 하므로 active=0 으로 내린다(소프트 삭제).
 * 명단·순번에서는 즉시 빠지고, 지난 달 장부는 그대로 남는다.
 */
export async function removeInstructor(db, ctx, p) {
  requireAdmin(ctx);
  const name = str(p.name, 50).trim();
  const res = await db.prepare("UPDATE instructors SET active = 0 WHERE name = ? AND active = 1")
    .bind(name).run();
  if (!res.meta || res.meta.changes === 0) throw missing("강사를 찾을 수 없습니다: " + name);
  await audit(db, ctx, "instructor.remove", name);
  return { ok: true };
}

export async function setHoliday(db, ctx, p) {
  requireAdmin(ctx);
  const date = assertDate(p.date);
  if (p.on) {
    await db.prepare(
      `INSERT INTO holidays (date, label) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET label = excluded.label`,
    ).bind(date, str(p.label, 60)).run();
  } else {
    await db.prepare("DELETE FROM holidays WHERE date = ?").bind(date).run();
  }
  await audit(db, ctx, "holiday.set", `${date}=${p.on ? 1 : 0}`);
  return { ok: true };
}

export async function setPublished(db, ctx, p) {
  requireAdmin(ctx);
  const ym = assertYm(p.ym);
  const published = p.published ? 1 : 0;
  await db.prepare(
    `INSERT INTO months (ym, published, published_at) VALUES (?, ?, ?)
     ON CONFLICT(ym) DO UPDATE SET published = excluded.published, published_at = excluded.published_at`,
  ).bind(ym, published, published ? nowIso() : null).run();
  await audit(db, ctx, "month.publish", `${ym}=${published}`);
  return { ok: true, ym, published: !!published };
}

/** ===== 백업 / 마이그레이션 ===== */

export async function exportAll(db, ctx) {
  requireAdmin(ctx);
  const [ins, adm, set, hol, mon, un, sub, ass] = await db.batch([
    db.prepare("SELECT * FROM instructors ORDER BY sort_order, name"),
    db.prepare("SELECT * FROM admins ORDER BY email"),
    db.prepare("SELECT * FROM settings ORDER BY key"),
    db.prepare("SELECT * FROM holidays ORDER BY date"),
    db.prepare("SELECT * FROM months ORDER BY ym"),
    db.prepare("SELECT * FROM unavailable ORDER BY date, name"),
    db.prepare("SELECT * FROM submissions ORDER BY ym, name"),
    db.prepare("SELECT * FROM assignments ORDER BY date, form, role"),
  ]);
  return {
    exportedAt: nowIso(),
    instructors: rows(ins), admins: rows(adm), settings: rows(set), holidays: rows(hol),
    months: rows(mon), unavailable: rows(un), submissions: rows(sub),
    assignments: rows(ass),
  };
}

/**
 * 구글시트에서 뽑아낸 데이터를 통째로 적재한다.
 * 같은 데이터를 두 번 넣어도 결과가 같도록 전부 UPSERT 로 처리한다(멱등).
 * 기존 행은 지우지 않으므로, 마이그레이션을 여러 번 나눠 돌려도 안전하다.
 */
export async function importAll(db, ctx, p) {
  requireAdmin(ctx);
  const dryRun = !!p.dryRun;
  const counts = {};
  const errors = [];
  const stmts = [];

  const push = (label, stmt) => { stmts.push(stmt); counts[label] = (counts[label] || 0) + 1; };
  const guard = (label, i, fn) => {
    try { fn(); } catch (e) { errors.push(`${label}[${i}]: ${e.message}`); }
  };

  (p.instructors || []).forEach((r, i) => guard("instructors", i, () => {
    const name = str(r.name, 50).trim();
    if (!name) throw new Error("이름 없음");
    push("instructors", db.prepare(
      `INSERT INTO instructors (name, sort_order, active) VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET sort_order = excluded.sort_order, active = excluded.active`,
    ).bind(name, Math.trunc(num(r.order ?? r.sort_order ?? i + 1)), r.active === 0 ? 0 : 1));
  }));

  (p.unavailable || []).forEach((r, i) => guard("unavailable", i, () => {
    const name = str(r.name, 50).trim();
    const date = assertDate(r.date);
    if (!name) throw new Error("이름 없음");
    push("unavailable", db.prepare(
      `INSERT INTO unavailable (name, date, reason, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(name, date) DO UPDATE SET reason = excluded.reason`,
    ).bind(name, date, str(r.reason, 200), nowIso()));
  }));

  (p.submissions || []).forEach((r, i) => guard("submissions", i, () => {
    const ym = assertYm(r.ym);
    const name = str(r.name, 50).trim();
    if (!name) throw new Error("이름 없음");
    const submitted = r.submitted === true || r.submitted === 1 || String(r.submitted).toUpperCase() === "TRUE" ? 1 : 0;
    push("submissions", db.prepare(
      `INSERT INTO submissions (ym, name, submitted, submitted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(ym, name) DO UPDATE SET submitted = excluded.submitted, submitted_at = excluded.submitted_at`,
    ).bind(ym, name, submitted, str(r.submittedAt ?? r.submitted_at, 40)));
  }));

  (p.assignments || []).forEach((r, i) => guard("assignments", i, () => {
    const date = assertDate(r.date);
    const name = str(r.name, 50).trim();
    const kind = str(r.kind, 20);
    if (!name) throw new Error("이름 없음");
    if (!ALL_KINDS.includes(kind)) throw new Error(`알 수 없는 유형: ${kind}`);
    const form = str(r.form, 20);
    const role = str(r.role, 20);
    if (!FORMS.includes(form)) throw new Error(`알 수 없는 형태: ${form}`);
    if (!ROLES.includes(role)) throw new Error(`알 수 없는 역할: ${role}`);
    const id = str(r.id, 64) || crypto.randomUUID();
    push("assignments", db.prepare(
      `INSERT INTO assignments (id, date, kind, form, role, name, h_explain, h_support, h_research, memo, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET date=excluded.date, kind=excluded.kind, form=excluded.form,
         role=excluded.role, name=excluded.name, h_explain=excluded.h_explain,
         h_support=excluded.h_support, h_research=excluded.h_research, memo=excluded.memo,
         updated_at=excluded.updated_at`,
    ).bind(id, date, kind, form, role, name,
      hours(r.hExplain ?? r.h_explain), hours(r.hSupport ?? r.h_support), hours(r.hResearch ?? r.h_research),
      str(r.memo, 500), nowIso()));
  }));

  // 구글시트 '설정' 탭은 rate/cap 외에 holiday.* / publish.* / admin.whitelist 가 섞여 있다.
  // 여기서 각자 제자리(holidays / months / admins)로 흩어 보낸다.
  (p.settings || []).forEach((r, i) => guard("settings", i, () => {
    const key = str(r.key, 80);
    const value = str(r.value, 300);
    if (!key) return;
    if (key.startsWith("holiday.")) {
      const date = assertDate(key.slice("holiday.".length));
      if (value === "" || value === "0" || value === "false") return;
      push("holidays", db.prepare(
        "INSERT INTO holidays (date, label) VALUES (?, '') ON CONFLICT(date) DO NOTHING",
      ).bind(date));
      return;
    }
    if (key.startsWith("publish.")) {
      const ym = assertYm(key.slice("publish.".length));
      const published = value && value !== "0" && value !== "false" ? 1 : 0;
      push("months", db.prepare(
        `INSERT INTO months (ym, published, published_at) VALUES (?, ?, ?)
         ON CONFLICT(ym) DO UPDATE SET published = excluded.published`,
      ).bind(ym, published, published ? nowIso() : null));
      return;
    }
    if (key === "admin.whitelist") {
      value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((email) => {
        push("admins", db.prepare(
          "INSERT INTO admins (email, note) VALUES (?, '시트에서 이관') ON CONFLICT(email) DO NOTHING",
        ).bind(email));
      });
      return;
    }
    if (ALLOWED_SETTINGS.includes(key)) {
      push("settings", db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, value, nowIso()));
      return;
    }
    errors.push(`settings[${i}]: 알 수 없는 키라 건너뜀 — ${key}`);
  }));

  if (dryRun) return { dryRun: true, counts, errors, statements: stmts.length };
  if (!stmts.length) return { dryRun: false, counts, errors, statements: 0 };

  // D1 배치는 한 번에 넣을 수 있는 문장 수에 한계가 있으므로 잘라서 보낸다.
  const CHUNK = 50;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await db.batch(stmts.slice(i, i + CHUNK));
  }
  await audit(db, ctx, "import", JSON.stringify(counts));
  return { dryRun: false, counts, errors, statements: stmts.length };
}
