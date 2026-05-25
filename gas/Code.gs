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
};

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
    return jsonOut({ ok: false, error: String(err && err.message || err) });
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
    if (headers) sh.appendRow(headers);
  } else if (headers && sh.getLastRow() === 0) {
    sh.appendRow(headers);
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
function writeRow(sh, headers, obj) {
  const row = headers.map((h) => (obj[h] !== undefined && obj[h] !== null) ? obj[h] : "");
  sh.appendRow(row);
}

/** ===== 데이터 ===== */
function ensureTabs() {
  getSheet(TABS.instructors, ["name", "order"]);
  getSheet(TABS.unavail, ["name", "date", "reason"]);
  getSheet(TABS.submit, ["ym", "name", "submitted", "submittedAt"]);
  getSheet(TABS.schedule, ["id", "date", "kind", "form", "role", "name", "hExplain", "hSupport", "hResearch", "memo"]);
  getSheet(TABS.seed, ["ym", "kind", "pointer", "lockedAt"]);
  getSheet(TABS.settings, ["key", "value"]);
  getSheet(TABS.carryover, ["srcYm", "name", "overflowExplainH", "compensationAmount", "recommendedH", "status", "note"]);
  seedDefaultsIfEmpty();
}

function seedDefaultsIfEmpty() {
  const insSh = getSheet(TABS.instructors, ["name", "order"]);
  const ins = readAll(insSh);
  if (!ins.length) {
    const rows = ["김경화", "신미정", "이경향", "이윤미"].map((n, i) => [n, i + 1]);
    insSh.getRange(insSh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
  }
  // ★ readSettings() 직접 호출 금지 (ensureTabs → seedDefaultsIfEmpty → readSettings → ensureTabs 무한 재귀).
  //   설정 시트를 한 번만 직접 읽는다.
  const settingsSh = getSheet(TABS.settings, ["key", "value"]);
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
    ["weeklyCap", 14],
    ["admin.whitelist", "i20091119@gmail.com"],
  ].concat(HOLIDAYS_2026.map((d) => ["holiday." + d, 1]));
  const missing = defaults.filter(([k]) => settings[k] === undefined);
  if (missing.length) {
    settingsSh.getRange(settingsSh.getLastRow() + 1, 1, missing.length, 2).setValues(missing);
  }
  // 2026-06 시드: 가족체험 0 (보조=신미정), 주말어드벤처 2 (토오전=이경향)
  const seedSh = getSheet(TABS.seed);
  const seed = readAll(seedSh);
  const has = (ym, kind) => seed.some((s) => String(s.ym) === ym && String(s.kind) === kind);
  const seedRows = [];
  const now = new Date().toISOString();
  if (!has("2026-06", "가족체험")) seedRows.push(["2026-06", "가족체험", 0, now]);
  if (!has("2026-06", "주말어드벤처")) seedRows.push(["2026-06", "주말어드벤처", 2, now]);
  if (seedRows.length) {
    seedSh.getRange(seedSh.getLastRow() + 1, 1, seedRows.length, 4).setValues(seedRows);
  }
}

function readSettings() {
  // ensureTabs를 호출하지 않는다 — 호출자가 책임지거나, getSheet에 헤더 인자로 자체 보장.
  const rows = readAll(getSheet(TABS.settings, ["key", "value"]));
  const obj = {};
  rows.forEach((r) => { obj[String(r.key)] = r.value; });
  return obj;
}

function bootstrap() {
  ensureTabs();
  const instructors = readAll(getSheet(TABS.instructors))
    .map((r) => String(r.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "ko"));
  return { instructors, settings: readSettings() };
}

function getMonth(ym) {
  ensureTabs();
  if (!ym) throw new Error("ym 누락");
  const inMonth = (d) => String(d).slice(0, 7) === ym;
  const assignments = readAll(getSheet(TABS.schedule))
    .filter((r) => inMonth(toDateStr(r.date)))
    .map((r) => ({
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
    }));
  const unavails = readAll(getSheet(TABS.unavail))
    .filter((r) => inMonth(toDateStr(r.date)))
    .map((r) => ({ name: String(r.name), date: toDateStr(r.date), reason: String(r.reason || "") }));
  const submits = readAll(getSheet(TABS.submit))
    .filter((r) => String(r.ym) === ym)
    .map((r) => ({ ym: String(r.ym), name: String(r.name), submitted: !!r.submitted, submittedAt: String(r.submittedAt || "") }));
  const seeds = readAll(getSheet(TABS.seed))
    .filter((r) => String(r.ym) === ym)
    .map((r) => ({ ym: String(r.ym), kind: String(r.kind), pointer: Number(r.pointer) }));
  const settings = readSettings();
  const holidays = Object.keys(settings)
    .filter((k) => k.indexOf("holiday.") === 0 && String(settings[k]))
    .map((k) => k.substring("holiday.".length))
    .filter((d) => d.slice(0, 7) === ym);
  return { ym, assignments, unavails, submits, seeds, holidays, published: !!settings["publish." + ym] };
}

function getCarryover(ym) {
  ensureTabs();
  return readAll(getSheet(TABS.carryover)).filter((r) => String(r.srcYm) === ym);
}

function toDateStr(v) {
  if (v instanceof Date) {
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return String(v || "");
}

function saveUnavailable(name, date, on, reason) {
  const sh = getSheet(TABS.unavail);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.name) === name && toDateStr(r.date) === date);
  if (on) {
    if (idx === -1) sh.appendRow([name, date, reason || ""]);
    else sh.getRange(rows[idx].__row, 1, 1, 3).setValues([[name, date, reason || ""]]);
  } else {
    if (idx !== -1) sh.deleteRow(rows[idx].__row);
  }
  // 등록 변경 시 제출 상태 해제
  setSubmit(name, date.slice(0, 7), false, "");
  return { ok: true };
}

function submitUnavailable(name, ym, submitted) {
  setSubmit(name, ym, submitted, submitted ? new Date().toISOString() : "");
  return { ok: true };
}

function setSubmit(name, ym, submitted, submittedAt) {
  const sh = getSheet(TABS.submit);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.ym) === ym && String(r.name) === name);
  if (idx === -1) sh.appendRow([ym, name, submitted, submittedAt]);
  else sh.getRange(rows[idx].__row, 1, 1, 4).setValues([[ym, name, submitted, submittedAt]]);
}

function saveAssignment(a) {
  const sh = getSheet(TABS.schedule);
  const headers = ["id", "date", "kind", "form", "role", "name", "hExplain", "hSupport", "hResearch", "memo"];
  const rows = readAll(sh);
  if (a.id) {
    const idx = rows.findIndex((r) => String(r.id) === String(a.id));
    if (idx === -1) throw new Error("배치를 찾을 수 없습니다: " + a.id);
    sh.getRange(rows[idx].__row, 1, 1, headers.length).setValues([[
      a.id, a.date, a.kind, a.form || "", a.role || "", a.name,
      a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || "",
    ]]);
    return { id: a.id };
  } else {
    const id = Utilities.getUuid();
    sh.appendRow([id, a.date, a.kind, a.form || "", a.role || "", a.name,
      a.hExplain || 0, a.hSupport || 0, a.hResearch || 0, a.memo || ""]);
    return { id };
  }
}

function deleteAssignment(id) {
  const sh = getSheet(TABS.schedule);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.id) === String(id));
  if (idx === -1) throw new Error("배치를 찾을 수 없습니다");
  sh.deleteRow(rows[idx].__row);
  return { ok: true };
}

function setSeed(ym, kind, pointer) {
  const sh = getSheet(TABS.seed);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.ym) === ym && String(r.kind) === kind);
  const now = new Date().toISOString();
  if (idx === -1) sh.appendRow([ym, kind, pointer, now]);
  else sh.getRange(rows[idx].__row, 1, 1, 4).setValues([[ym, kind, pointer, now]]);
  return { ok: true };
}

function setSetting(key, value) {
  const sh = getSheet(TABS.settings);
  const rows = readAll(sh);
  const idx = rows.findIndex((r) => String(r.key) === String(key));
  if (idx === -1) sh.appendRow([key, value]);
  else sh.getRange(rows[idx].__row, 1, 1, 2).setValues([[key, value]]);
  return { ok: true };
}
