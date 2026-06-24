/**
 * 경남수학문화관 SW해설강사 일정 관리 — GAS 백엔드
 *
 * 배포: 새 Apps Script 프로젝트 → 이 파일 붙여넣기 → 배포 > 웹앱
 *  - 다음 사용자로 실행: 본인
 *  - 액세스 권한: 누구나
 *  - 시트 ID와 OAuth 클라이언트 ID를 아래 상수에 채워넣을 것
 */

const SHEET_ID = "1u05m1rwGDqCsWyrVE_W4NLPgOgKjKYZtx9M_xhlWg-g";
// 프론트엔드와 동일한 OAuth 2.0 클라이언트 ID (Google Cloud Console)
const GOOGLE_OAUTH_CLIENT_ID = "79888472929-34mqbk6lr9d5b6j7ugmommpie75ak98i.apps.googleusercontent.com";

const TABS = {
  instructors: "강사",
  unavail: "근무불가일",
  submit: "제출현황",
  schedule: "일정",
  seed: "순번시드",
  settings: "설정",
  carryover: "이월",
  swap: "교체요청",
  program: "학생프로그램",
};

const HEADERS = {
  instructors: ["name", "order"],
  unavail: ["name", "date", "reason"],
  submit: ["ym", "name", "submitted", "submittedAt"],
  schedule: ["id", "date", "kind", "form", "role", "name", "hExplain", "hSupport", "hResearch", "memo", "carry"],
  seed: ["ym", "kind", "pointer", "lockedAt"],
  settings: ["key", "value"],
  carryover: ["srcYm", "name", "overflowExplainH", "compensationAmount", "recommendedH", "status", "note"],
  swap: ["id", "ym", "assignmentId", "requester", "target", "status", "requestedAt", "respondedAt", "finalizedAt", "note"],
  program: ["id", "dateStart", "dateEnd", "session", "school", "students", "note"],
};

function isTrue(v) {
  if (v === true) return true;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes";
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: "잘못된 요청 본문" });
  }
  const { action, payload, auth } = body || {};
  try {
    const ctx = resolveAuth(auth);
    const data = dispatch(action, payload || {}, ctx);
    return jsonOut({ ok: true, data });
  } catch (err) {
    return jsonOut({
      ok: false,
      error: String(err && err.message || err),
      stack: String(err && err.stack || ""),
      action: action || "",
    });
  }
}

function doGet() {
  // 헬스체크
  return jsonOut({ ok: true, data: { service: "SWT", time: new Date().toISOString() } });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** ===== 인증 ===== */
function resolveAuth(auth) {
  if (!auth) return { role: "guest" };
  if (auth.role === "instructor" && auth.name) {
    return { role: "instructor", name: String(auth.name) };
  }
  if (auth.role === "admin" && auth.idToken) {
    const email = verifyGoogleIdToken(auth.idToken);
    const whitelist = getAdminWhitelist();
    if (!email || whitelist.indexOf(email.toLowerCase()) === -1) {
      throw new Error("관리자 권한이 없습니다.");
    }
    return { role: "admin", email };
  }
  return { role: "guest" };
}

function verifyGoogleIdToken(idToken) {
  // Google tokeninfo로 서명·만료·aud 확인.
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return null;
  const info = JSON.parse(resp.getContentText());
  if (!info.email || info.email_verified !== "true" && info.email_verified !== true) return null;
  if (info.aud !== GOOGLE_OAUTH_CLIENT_ID) {
    throw new Error("OAuth 클라이언트 ID 불일치");
  }
  if (Number(info.exp) * 1000 < Date.now()) return null;
  return String(info.email).toLowerCase();
}

function getAdminWhitelist() {
  const s = readSettings();
  const raw = String(s["admin.whitelist"] || "i20091119@gmail.com");
  return raw.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** ===== 디스패치 ===== */
function dispatch(action, p, ctx) {
  switch (action) {
    case "bootstrap": return bootstrap();
    case "verifyAdmin": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 실패");
      return { email: ctx.email };
    }
    case "getMonth": return getMonth(p.ym);
    case "getCarryover": return getCarryover(p.ym);
    case "saveUnavailable": {
      if (ctx.role !== "instructor") throw new Error("강사 인증 필요");
      return withLock(() => saveUnavailable(ctx.name, p.date, p.on, p.reason || ""));
    }
    case "submitUnavailable": {
      if (ctx.role !== "instructor") throw new Error("강사 인증 필요");
      return withLock(() => submitUnavailable(ctx.name, p.ym, !!p.submitted));
    }
    case "saveAssignment": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => saveAssignment(p));
    }
    case "saveAssignmentsBatch": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => saveAssignmentsBatch(p.assignments));
    }
    case "deleteAssignment": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => deleteAssignment(p.id));
    }
    case "setSeed": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => setSeed(p.ym, p.kind, Number(p.pointer)));
    }
    case "setSetting": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => setSetting(p.key, p.value));
    }
    case "createSwap": {
      if (ctx.role !== "instructor") throw new Error("강사 인증 필요");
      return withLock(() => createSwap(ctx.name, p));
    }
    case "cancelSwap": {
      if (ctx.role !== "instructor") throw new Error("강사 인증 필요");
      return withLock(() => cancelSwap(ctx.name, p));
    }
    case "approveSwap": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => approveSwap(ctx.email, p));
    }
    case "rejectSwap": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => rejectSwap(ctx.email, p));
    }
    case "createProgram": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => createProgram(p));
    }
    case "updateProgram": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => updateProgram(p));
    }
    case "deleteProgram": {
      if (ctx.role !== "admin") throw new Error("관리자 인증 필요");
      return withLock(() => deleteProgram(p.id));
    }
    default: throw new Error("알 수 없는 action: " + action);
  }
}

function withLock(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/** ===== 시트 헬퍼 ===== */
function getSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    if (headers) {
      try { sh.getRange(1, 1, 1, headers.length).setValues([headers]); } catch (e) {}
    }
    return sh;
  }
  if (headers) {
    try {
      const last = sh.getLastRow();
      if (last === 0) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      } else {
        // 1행이 정확한 헤더가 아니면 1행 위에 헤더를 삽입해 자동 복구
        const cols = Math.max(sh.getLastColumn(), headers.length);
        const firstRow = sh.getRange(1, 1, 1, cols).getValues()[0];
        const matches = headers.every((h, i) => String(firstRow[i] == null ? "" : firstRow[i]) === h);
        if (!matches) {
          sh.insertRowBefore(1);
          sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        }
      }
    } catch (e) {
      // 헤더 복구 실패해도 시트 사용은 가능하도록 무시
    }
  }
  return sh;
}
function readAll(sh) {
  const values = sh.getDataRange().getValues();
  if (!values.length) return [];
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i].every((v) => v === "" || v === null)) continue;
    const obj = {};
    headers.forEach((h, j) => { obj[h] = values[i][j]; });
    obj.__row = i + 1;
    rows.push(obj);
  }
  return rows;
}

/** ===== CacheService 캐시 =====
 * 시트 readAll 결과를 스크립트 전역 캐시에 5분 보관. 쓰기 시 해당 탭만 invalidate.
 * 캐시는 모든 사용자/요청이 공유 → 첫 호출만 시트 IO, 이후는 ~10ms.
 */
var _CACHE_TTL = 300; // seconds (max 21600)
function _cacheKey(name) { return "tab_v2_" + name; }

function _normalizeRow(r) {
  // Date 객체는 JSON 직렬화 시 ISO string이 되는데, 역직렬화 후 비교를 위해 미리 yyyy-MM-dd로 변환.
  // (HH:MM 등 시간 정보가 필요한 컬럼은 GAS 코드가 처음부터 string으로 저장하므로 영향 없음)
  const out = {};
  Object.keys(r).forEach((k) => {
    const v = r[k];
    out[k] = (v instanceof Date)
      ? Utilities.formatDate(v, Session.getScriptTimeZone() || "Asia/Seoul", "yyyy-MM-dd")
      : v;
  });
  return out;
}

function readAllCached(sh) {
  var cache;
  try { cache = CacheService.getScriptCache(); } catch (e) { return readAll(sh); }
  var name = sh.getName();
  var key = _cacheKey(name);
  try {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  } catch (e) {}
  var rows = readAll(sh).map(_normalizeRow);
  try { cache.put(key, JSON.stringify(rows), _CACHE_TTL); } catch (e) {}
  return rows;
}

function invalidateCache() {
  try {
    var cache = CacheService.getScriptCache();
    for (var k in TABS) cache.remove(_cacheKey(TABS[k]));
  } catch (e) {}
}
function invalidateTab(name) {
  try { CacheService.getScriptCache().remove(_cacheKey(name)); } catch (e) {}
}
function writeRow(sh, headers, obj) {
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : "");
  sh.appendRow(row);
}

/** ===== 데이터 ===== */
function ensureTabs() {
  getSheet(TABS.instructors, HEADERS.instructors);
  getSheet(TABS.unavail, HEADERS.unavail);
  getSheet(TABS.submit, HEADERS.submit);
  getSheet(TABS.schedule, HEADERS.schedule);
  getSheet(TABS.seed, HEADERS.seed);
  getSheet(TABS.settings, HEADERS.settings);
  getSheet(TABS.carryover, HEADERS.carryover);
  getSheet(TABS.swap, HEADERS.swap);
  getSheet(TABS.program, HEADERS.program);
  seedDefaultsIfEmpty();
}

function seedDefaultsIfEmpty() {
  const insSh = getSheet(TABS.instructors, HEADERS.instructors);
  const ins = readAll(insSh);
  if (!ins.length) {
    const rows = ["김경화", "신미정", "이경향", "이윤미"].map((n, i) => [n, i + 1]);
    insSh.getRange(insSh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
  }
  // ★ readSettings() 직접 호출 금지 (ensureTabs → seedDefaultsIfEmpty → readSettings → ensureTabs 무한 재귀).
  //   설정 시트를 한 번만 직접 읽는다.
  const settingsSh = getSheet(TABS.settings, HEADERS.settings);
  const settings = {};
  readAll(settingsSh).forEach((r) => { settings[String(r.key)] = r.value; });
  const HOLIDAYS_2026 = [
    "2026-01-01","2026-02-16","2026-02-17","2026-02-18",
    "2026-03-01","2026-03-02","2026-05-05","2026-05-24","2026-05-25",
    "2026-06-06","2026-08-15","2026-08-17",
    "2026-09-24","2026-09-25","2026-09-26","2026-09-28",
    "2026-10-03","2026-10-05","2026-10-09","2026-12-25",
  ];
  const defaults = [
    ["rate.explain", 30000],
    ["rate.other", 20000],
    ["weeklyCap", 20],
    ["admin.whitelist", "i20091119@gmail.com"],
  ].concat(HOLIDAYS_2026.map((d) => ["holiday." + d, 1]));
  const missing = defaults.filter(([k]) => settings[k] === undefined);
  if (missing.length) {
    settingsSh.getRange(settingsSh.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  }
  // 2026-06 시드: 가족체험 0 (보조=신미정), 주말어드벤처 2 (토오전=이경향)
  const seedSh = getSheet(TABS.seed, HEADERS.seed);
  const seed = readAll(seedSh);
  const has = (ym, kind) => seed.some((s) => ymOf(s.ym) === ym && String(s.kind) === kind);
  const seedRows = [];
  const now = new Date().toISOString();
  if (!has("2026-06", "가족체험")) seedRows.push(["2026-06", "가족체험", 0, now]);
  if (!has("2026-06", "주말어드벤처")) seedRows.push(["2026-06", "주말어드벤처", 2, now]);
  if (seedRows.length) {
    seedSh.getRange(seedSh.getLastRow() + 1, 1, seedRows.length, 4).setValues(seedRows);
  }
  invalidateCache();
}

function readSettings() {
  const rows = readAllCached(getSheet(TABS.settings, HEADERS.settings));
  const obj = {};
  rows.forEach((r) => { obj[String(r.key)] = r.value; });
  return obj;
}

function bootstrap() {
  ensureTabs();
  const instructors = readAllCached(getSheet(TABS.instructors, HEADERS.instructors))
    .map((r) => String(r.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  return { instructors, settings: readSettings() };
}

function getMonth(ym) {
  if (!ym) throw new Error("ym 누락");
  // ensureTabs는 bootstrap에서만 호출. 매 getMonth마다 9 시트 헤더 검사는 비용 큼.
  const inMonth = (d) => String(d).slice(0, 7) === ym;
  // 전월 계산 (이월 계산용으로 함께 반환 — 별도 호출 회피)
  const [py, pm] = ym.split("-").map(Number);
  const prevD = new Date(py, pm - 2, 1);
  const prevYm = prevD.getFullYear() + "-" + String(prevD.getMonth() + 1).padStart(2, "0");
  const inPrev = (d) => String(d).slice(0, 7) === prevYm;
  // schedule을 한 번만 읽고 현재달/전월로 분기 (시트 액세스 비용 절감)
  const allSchedule = readAllCached(getSheet(TABS.schedule));
  const mapAssign = (r) => ({
    id: String(r.id),
    date: toDateStr(r.date),
    kind: String(r.kind || ""),
    form: String(r.form || ""),
    role: String(r.role || ""),
    name: String(r.name || ""),
    hExplain: Number(r.hExplain || 0),
    hSupport: Number(r.hSupport || 0),
    hResearch: Number(r.hResearch || 0),
    memo: String(r.memo || ""),
    carry: isTrue(r.carry),
  });
  const assignments = allSchedule.filter((r) => inMonth(toDateStr(r.date))).map(mapAssign);
  const prevAssignments = allSchedule.filter((r) => inPrev(toDateStr(r.date))).map(mapAssign);
  const unavails = readAllCached(getSheet(TABS.unavail))
    .filter((r) => inMonth(toDateStr(r.date)))
    .map((r) => ({ name: String(r.name), date: toDateStr(r.date), reason: String(r.reason || "") }));
  const submits = readAllCached(getSheet(TABS.submit))
    .filter((r) => ymOf(r.ym) === ym)
    .map((r) => ({ ym: ymOf(r.ym), name: String(r.name), submitted: isTrue(r.submitted), submittedAt: String(r.submittedAt || "") }));
  const seeds = readAllCached(getSheet(TABS.seed))
    .filter((r) => ymOf(r.ym) === ym)
    .map((r) => ({ ym: ymOf(r.ym), kind: String(r.kind), pointer: Number(r.pointer) }));
  const swaps = readAllCached(getSheet(TABS.swap))
    .filter((r) => ymOf(r.ym) === ym)
    .map((r) => ({
      id: String(r.id),
      ym: ymOf(r.ym),
      assignmentId: String(r.assignmentId),
      requester: String(r.requester),
      target: String(r.target),
      status: String(r.status),
      requestedAt: String(r.requestedAt || ""),
      respondedAt: String(r.respondedAt || ""),
      finalizedAt: String(r.finalizedAt || ""),
      note: String(r.note || ""),
    }));
  const programs = readAllCached(getSheet(TABS.program))
    .map((r) => ({
      id: String(r.id),
      dateStart: toDateStr(r.dateStart),
      dateEnd: toDateStr(r.dateEnd),
      session: String(r.session || ""),
      school: String(r.school || ""),
      students: Number(r.students || 0),
      note: String(r.note || ""),
    }))
    .filter((p) => p.dateStart.slice(0, 7) === ym || p.dateEnd.slice(0, 7) === ym
      || (p.dateStart < ym + "-01" && p.dateEnd > ym + "-31"));
  const settings = readSettings();
  const holidays = Object.keys(settings)
    .filter((k) => k.indexOf("holiday.") === 0 && String(settings[k]))
    .map((k) => k.substring("holiday.".length))
    .filter((d) => d.slice(0, 7) === ym);
  return { ym, assignments, prevAssignments, unavails, submits, seeds, swaps, programs, holidays, published: isTrue(settings["publish." + ym]) };
}

function getCarryover(ym) {
  return readAllCached(getSheet(TABS.carryover)).filter((r) => ymOf(r.srcYm) === ym);
}

function toDateStr(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || "Asia/Seoul", "yyyy-MM-dd");
  }
  var s = String(v == null ? "" : v);
  // ISO timestamp 등 'YYYY-MM-DD...' 형태면 앞 10글자만 (캐시 후 ISO string 처리)
  if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function ymOf(v) {
  if (v instanceof Date) return toDateStr(v).slice(0, 7);
  var s = String(v == null ? "" : v);
  if (s.length >= 7 && /^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return s;
}

function saveUnavailable(name, date, on, reason) {
  const sh = getSheet(TABS.unavail, HEADERS.unavail);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.name) === name && toDateStr(r.date) === date);
  if (on) {
    if (idx === -1) sh.appendRow([name, date, reason || ""]);
    else sh.getRange(rows[idx].__row, 1, 1, 3).setValues([[name, date, reason || ""]]);
  } else {
    if (idx !== -1) sh.deleteRow(rows[idx].__row);
  }
  invalidateTab(TABS.unavail);
  // 등록 변경 시 제출 상태 해제
  setSubmit(name, date.slice(0, 7), false, "");
  return { ok: true };
}

function submitUnavailable(name, ym, submitted) {
  setSubmit(name, ym, submitted, submitted ? new Date().toISOString() : "");
  return { ok: true };
}

function setSubmit(name, ym, submitted, submittedAt) {
  const sh = getSheet(TABS.submit, HEADERS.submit);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => ymOf(r.ym) === ym && String(r.name) === name);
  if (idx === -1) sh.appendRow([ym, name, submitted, submittedAt]);
  else sh.getRange(rows[idx].__row, 1, 1, 4).setValues([[ym, name, submitted, submittedAt]]);
  invalidateTab(TABS.submit);
}

function saveAssignment(a) {
  const sh = getSheet(TABS.schedule, HEADERS.schedule);
  const headers = HEADERS.schedule;
  const rows = readAll(sh);
  const carry = isTrue(a.carry);
  if (a.id) {
    const idx = rows.findIndex((r) => String(r.id) === String(a.id));
    if (idx !== -1) {
      sh.getRange(rows[idx].__row, 1, 1, headers.length).setValues([[
        a.id, a.date, a.kind, a.form || "", a.role || "", a.name,
        a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || "", carry,
      ]]);
      invalidateTab(TABS.schedule);
      return { id: a.id, mode: "updated" };
    }
    // ID는 있는데 시트에 행이 없음 — 캐시 어긋남으로 보고 그 ID 그대로 새로 삽입(upsert)
    sh.appendRow([
      a.id, a.date, a.kind, a.form || "", a.role || "", a.name,
      a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || "", carry,
    ]);
    invalidateTab(TABS.schedule);
    return { id: a.id, mode: "reinserted" };
  } else {
    const id = Utilities.getUuid();
    sh.appendRow([id, a.date, a.kind, a.form || "", a.role || "", a.name,
      a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || "", carry]);
    invalidateTab(TABS.schedule);
    return { id, mode: "created" };
  }
}

function saveAssignmentsBatch(assignments) {
  if (!Array.isArray(assignments) || !assignments.length) return { count: 0, ids: [] };
  const sh = getSheet(TABS.schedule, HEADERS.schedule);
  const ids = [];
  const rows = assignments.map((a) => {
    const id = Utilities.getUuid();
    ids.push(id);
    return [
      id, a.date, a.kind, a.form || "", a.role || "", a.name,
      a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || "", isTrue(a.carry),
    ];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.schedule.length).setValues(rows);
  invalidateTab(TABS.schedule);
  return { count: rows.length, ids };
}

function deleteAssignment(id) {
  const sh = getSheet(TABS.schedule, HEADERS.schedule);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.id) === String(id));
  if (idx === -1) {
    // 이미 삭제된 상태로 간주 (캐시 어긋남) — 멱등 처리
    invalidateTab(TABS.schedule);
    return { ok: true, mode: "already_gone" };
  }
  sh.deleteRow(rows[idx].__row);
  invalidateTab(TABS.schedule);
  return { ok: true, mode: "deleted" };
}

function setSeed(ym, kind, pointer) {
  const sh = getSheet(TABS.seed, HEADERS.seed);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => ymOf(r.ym) === ym && String(r.kind) === kind);
  const now = new Date().toISOString();
  if (idx === -1) sh.appendRow([ym, kind, pointer, now]);
  else sh.getRange(rows[idx].__row, 1, 1, 4).setValues([[ym, kind, pointer, now]]);
  invalidateTab(TABS.seed);
  return { ok: true };
}

function setSetting(key, value) {
  const sh = getSheet(TABS.settings, HEADERS.settings);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.key) === String(key));
  if (idx === -1) sh.appendRow([key, value]);
  else sh.getRange(rows[idx].__row, 1, 1, 2).setValues([[key, value]]);
  invalidateTab(TABS.settings);
  return { ok: true };
}

/** ===== 수업 교체 (swap) =====
 * 흐름: requester가 createSwap → 관리자가 approveSwap/rejectSwap (또는 requester가 cancelSwap).
 * approveSwap 시점에 schedule 시트의 해당 배치의 name이 target으로 변경된다.
 * status: pending_admin → completed / rejected / cancelled
 */
function createSwap(requester, p) {
  if (!p || !p.assignmentId || !p.target) throw new Error("assignmentId/target 누락");
  const schSh = getSheet(TABS.schedule, HEADERS.schedule);
  const schRows = readAll(schSh);
  const a = schRows.find((r) => String(r.id) === String(p.assignmentId));
  if (!a) throw new Error("배치를 찾을 수 없습니다");
  if (String(a.name) !== requester) throw new Error("본인 배치만 교체 신청할 수 있습니다");
  if (String(a.name) === String(p.target)) throw new Error("자기 자신과는 교체할 수 없습니다");
  const ym = toDateStr(a.date).slice(0, 7);
  const settings = readSettings();
  if (!isTrue(settings["publish." + ym])) throw new Error("확정 활동표 발표 후에 신청 가능");
  // 같은 배치에 대해 진행 중인 요청이 있으면 막음
  const swapSh = getSheet(TABS.swap, HEADERS.swap);
  const swaps = readAll(swapSh);
  const active = swaps.find((s) => String(s.assignmentId) === String(p.assignmentId)
    && String(s.status) === "pending_admin");
  if (active) throw new Error("이 배치는 이미 관리자 승인 대기 중입니다");
  const id = Utilities.getUuid();
  const now = new Date().toISOString();
  swapSh.appendRow([id, ym, String(p.assignmentId), requester, String(p.target),
    "pending_admin", now, "", "", String(p.note || "")]);
  invalidateTab(TABS.swap);
  return { id };
}

function _findSwap(swapId) {
  const sh = getSheet(TABS.swap, HEADERS.swap);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.id) === String(swapId));
  if (idx === -1) throw new Error("교체 요청을 찾을 수 없습니다");
  return { sh, rows, idx, row: rows[idx] };
}

function _updateSwap(sh, row, patch) {
  const headers = HEADERS.swap;
  const merged = headers.map((h) => (patch[h] !== undefined ? patch[h] : (row[h] !== undefined ? row[h] : "")));
  sh.getRange(row.__row, 1, 1, headers.length).setValues([merged]);
  invalidateTab(TABS.swap);
}

function approveSwap(adminEmail, p) {
  const { sh, row } = _findSwap(p.swapId);
  if (String(row.status) !== "pending_admin") throw new Error("현재 상태에서 승인할 수 없습니다");
  const schSh = getSheet(TABS.schedule, HEADERS.schedule);
  const schRows = readAll(schSh);
  const a = schRows.find((r) => String(r.id) === String(row.assignmentId));
  if (!a) throw new Error("원본 배치가 사라졌습니다");
  if (String(a.name) !== String(row.requester)) throw new Error("원본 배치의 강사가 신청자와 다릅니다");
  const nameColIdx = HEADERS.schedule.indexOf("name") + 1;
  schSh.getRange(a.__row, nameColIdx, 1, 1).setValues([[String(row.target)]]);
  invalidateTab(TABS.schedule);
  const now = new Date().toISOString();
  _updateSwap(sh, row, { status: "completed", respondedAt: now, finalizedAt: now });
  return { ok: true };
}

function rejectSwap(adminEmail, p) {
  const { sh, row } = _findSwap(p.swapId);
  if (String(row.status) !== "pending_admin") throw new Error("현재 상태에서 거절할 수 없습니다");
  const now = new Date().toISOString();
  _updateSwap(sh, row, { status: "rejected", respondedAt: now, finalizedAt: now });
  return { ok: true };
}

function cancelSwap(requester, p) {
  const { sh, row } = _findSwap(p.swapId);
  if (String(row.requester) !== requester) throw new Error("신청자만 취소할 수 있습니다");
  if (String(row.status) !== "pending_admin") throw new Error("이미 종료된 요청입니다");
  _updateSwap(sh, row, { status: "cancelled", finalizedAt: new Date().toISOString() });
  return { ok: true };
}

/** ===== 학생 프로그램 =====
 * 시트 '학생프로그램' 탭. 1 row = 한 기간(시작일~종료일)의 한 프로그램.
 * 캘린더 셀에 표시되며 강사·관리자 모두 본다.
 */
function createProgram(p) {
  if (!p || !p.dateStart || !p.school) throw new Error("시작일과 학교는 필수입니다");
  const sh = getSheet(TABS.program, HEADERS.program);
  const id = Utilities.getUuid();
  sh.appendRow([
    id,
    String(p.dateStart),
    String(p.dateEnd || p.dateStart),
    String(p.session || ""),
    String(p.school),
    Number(p.students || 0),
    String(p.note || ""),
  ]);
  invalidateTab(TABS.program);
  return { id };
}

function updateProgram(p) {
  if (!p || !p.id) throw new Error("id 누락");
  const sh = getSheet(TABS.program, HEADERS.program);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.id) === String(p.id));
  if (idx === -1) throw new Error("프로그램을 찾을 수 없습니다");
  sh.getRange(rows[idx].__row, 1, 1, HEADERS.program.length).setValues([[
    p.id,
    String(p.dateStart),
    String(p.dateEnd || p.dateStart),
    String(p.session || ""),
    String(p.school),
    Number(p.students || 0),
    String(p.note || ""),
  ]]);
  invalidateTab(TABS.program);
  return { ok: true };
}

function deleteProgram(id) {
  if (!id) throw new Error("id 누락");
  const sh = getSheet(TABS.program, HEADERS.program);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.id) === String(id));
  if (idx === -1) throw new Error("프로그램을 찾을 수 없습니다");
  sh.deleteRow(rows[idx].__row);
  invalidateTab(TABS.program);
  return { ok: true };
}

/**
 * 일회성 시드: 사용자 제공 학생 프로그램 데이터 (2026 운영).
 * 동일한 (dateStart, dateEnd, session, school)이 이미 있으면 건너뜀(중복 방지).
 */
function seedPrograms2026() {
  const sh = getSheet(TABS.program, HEADERS.program);
  const rows = readAll(sh);
  const data = [
    { dateStart: "2026-06-09", dateEnd: "2026-06-12", session: "오전", school: "호계초", students: 22 },
    { dateStart: "2026-06-16", dateEnd: "2026-06-18", session: "오전", school: "호계초", students: 22 },
    { dateStart: "2026-06-23", dateEnd: "2026-06-23", session: "오전", school: "진례초", students: 30 },
    { dateStart: "2026-07-01", dateEnd: "2026-07-03", session: "오전", school: "창신중", students: 30 },
    { dateStart: "2026-07-08", dateEnd: "2026-07-08", session: "오전", school: "우산초", students: 18 },
    { dateStart: "2026-07-09", dateEnd: "2026-07-09", session: "오전", school: "진전중", students: 30 },
    { dateStart: "2026-09-15", dateEnd: "2026-09-15", session: "오전", school: "대산초", students: 27 },
    { dateStart: "2026-09-22", dateEnd: "2026-09-22", session: "오후", school: "진해남중", students: 30 },
  ];
  const added = [];
  const skipped = [];
  data.forEach((p) => {
    const exists = rows.some((r) =>
      toDateStr(r.dateStart) === p.dateStart &&
      toDateStr(r.dateEnd) === p.dateEnd &&
      String(r.session) === p.session &&
      String(r.school) === p.school
    );
    if (exists) { skipped.push(p.school + " " + p.dateStart); return; }
    sh.appendRow([Utilities.getUuid(), p.dateStart, p.dateEnd, p.session, p.school, p.students, ""]);
    added.push(p.school + " " + p.dateStart);
  });
  Logger.log("added=" + JSON.stringify(added) + " skipped=" + JSON.stringify(skipped));
  invalidateCache();
  return { added, skipped };
}

/**
 * 일회성 시드: 추가 학생 프로그램 (학교체험 + 어드벤처관 + 가족SW체험교실).
 * 동일한 (dateStart, dateEnd, session, school)이 이미 있으면 건너뜀.
 */
function seedPrograms2026Extra() {
  const sh = getSheet(TABS.program, HEADERS.program);
  const rows = readAll(sh);
  const data = [];

  // 학교체험 추가 (10~12월)
  data.push(
    { dateStart: "2026-10-01", dateEnd: "2026-10-01", session: "오전", school: "감천초",   students: 17 },
    { dateStart: "2026-10-23", dateEnd: "2026-10-23", session: "오전", school: "한들초",   students: 26 },
    { dateStart: "2026-11-04", dateEnd: "2026-11-05", session: "오전", school: "상북초",   students: 19 },
    { dateStart: "2026-11-10", dateEnd: "2026-11-13", session: "오전", school: "평산초",   students: 21 },
    { dateStart: "2026-12-01", dateEnd: "2026-12-04", session: "오전", school: "창원여중", students: 30 },
    { dateStart: "2026-12-08", dateEnd: "2026-12-10", session: "오전", school: "창원여중", students: 30 }
  );

  // 어드벤처관(일요일 오전)
  ["2026-06-07","2026-06-14","2026-06-21","2026-06-28",
   "2026-07-05","2026-07-12","2026-07-19","2026-07-26",
   "2026-08-02","2026-08-09","2026-08-16","2026-08-23","2026-08-30",
   "2026-09-06","2026-09-13","2026-09-20","2026-09-27",
   "2026-10-04","2026-10-11","2026-10-18","2026-10-25",
   "2026-11-01","2026-11-08","2026-11-15","2026-11-22","2026-11-29",
   "2026-12-06","2026-12-13","2026-12-20","2026-12-27"
  ].forEach((d) => {
    data.push({ dateStart: d, dateEnd: d, session: "오전", school: "어드벤처관", students: 0 });
  });

  // 어드벤처관(토요일 오전+오후)
  ["2026-06-13","2026-06-20","2026-06-27",
   "2026-07-04","2026-07-11","2026-07-18","2026-07-25",
   "2026-08-01","2026-08-08","2026-08-22","2026-08-29",
   "2026-09-05","2026-09-12","2026-09-19",
   "2026-10-10","2026-10-17","2026-10-24","2026-10-31",
   "2026-11-07","2026-11-14","2026-11-21","2026-11-28",
   "2026-12-05","2026-12-12","2026-12-19","2026-12-26"
  ].forEach((d) => {
    data.push({ dateStart: d, dateEnd: d, session: "오전", school: "어드벤처관", students: 0 });
    data.push({ dateStart: d, dateEnd: d, session: "오후", school: "어드벤처관", students: 0 });
  });

  // 가족SW체험교실 (세션 명시 없음)
  ["2026-06-13","2026-06-20","2026-06-27",
   "2026-07-04","2026-07-11","2026-07-18","2026-07-25",
   "2026-08-01","2026-08-08","2026-08-22","2026-08-29",
   "2026-09-05","2026-09-12","2026-09-19",
   "2026-10-10","2026-10-17","2026-10-24","2026-10-31",
   "2026-11-07","2026-11-14","2026-11-21","2026-11-28",
   "2026-12-05","2026-12-12"
  ].forEach((d) => {
    data.push({ dateStart: d, dateEnd: d, session: "", school: "가족SW체험교실", students: 0 });
  });

  let added = 0, skipped = 0;
  data.forEach((p) => {
    const exists = rows.some((r) =>
      toDateStr(r.dateStart) === p.dateStart &&
      toDateStr(r.dateEnd) === p.dateEnd &&
      String(r.session) === p.session &&
      String(r.school) === p.school
    );
    if (exists) { skipped++; return; }
    sh.appendRow([Utilities.getUuid(), p.dateStart, p.dateEnd, p.session, p.school, p.students, ""]);
    added++;
  });
  Logger.log("added=" + added + " skipped=" + skipped);
  invalidateCache();
  return { added, skipped };
}

/**
 * 일회성 시드: 2026-05 → 2026-06 이월 데이터.
 * 6월 1일에 김경화/이경향/이윤미 각각 "연구이월" 3시간 추가.
 * 이미 동일한(name + date + kind) row가 있으면 건너뜀(중복 방지).
 * GAS Editor에서 직접 이 함수를 실행한 뒤 결과 로그를 확인.
 */
function seedMayToJuneCarryover() {
  const sh = getSheet(TABS.schedule, HEADERS.schedule);
  const rows = readAll(sh);
  const date = "2026-06-01";
  const kind = "연구이월";
  const memo = "5/11 이월분";
  const targets = ["김경화", "이경향", "이윤미"];
  const added = [];
  const skipped = [];
  targets.forEach((name) => {
    const exists = rows.some((r) =>
      String(r.name) === name &&
      toDateStr(r.date) === date &&
      String(r.kind) === kind
    );
    if (exists) { skipped.push(name); return; }
    const id = Utilities.getUuid();
    sh.appendRow([id, date, kind, "", "", name, 0, 0, 3, memo]);
    added.push(name);
  });
  Logger.log("added=" + JSON.stringify(added) + " skipped=" + JSON.stringify(skipped));
  invalidateCache();
  return { added, skipped };
}
