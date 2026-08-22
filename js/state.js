// 전역 상태(브라우저 메모리). 새로고침 시 sessionStorage로 복원.
window.STATE = {
  user: null,            // { role:'instructor'|'admin', name?:string, email?:string }
  sessionToken: null,    // 서버가 발급한 세션 토큰 (HMAC 서명, 12시간)
  instructors: [],       // 가나다순 (순번·명단 기준) — 서버가 정렬해 내려준다
  assignableNames: [],   // 배치 가능한 전체 이름 (순번에 넣지 않는 파견교사 포함)
  settings: {},          // weeklyCap (주간 상한)
  cache: {
    monthData: {},       // ym -> getMonth 응답
  },
};

const SESSION_KEY = "swt_session";

window.STATE.save = function () {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      user: STATE.user,
      sessionToken: STATE.sessionToken,
    }));
  } catch (e) {}
};
window.STATE.restore = function () {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    STATE.user = s.user || null;
    STATE.sessionToken = s.sessionToken || null;
  } catch (e) {}
};
window.STATE.clear = function () {
  STATE.user = null;
  STATE.sessionToken = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem("swt_instructors");
    sessionStorage.removeItem("swt_settings");
    Object.keys(sessionStorage)
      .filter((k) => k.indexOf("swt_month_") === 0)
      .forEach((k) => sessionStorage.removeItem(k));
  } catch (e) {}
  if (window.api && api.clearCache) api.clearCache();
};

// 강사 목록/설정을 sessionStorage에 캐시 (페이지 새로고침 시 즉시 표시 + 백그라운드 refresh)
window.STATE.saveBootCache = function () {
  try {
    sessionStorage.setItem("swt_instructors", JSON.stringify({
      instructors: STATE.instructors,
      assignableNames: STATE.assignableNames,
    }));
    sessionStorage.setItem("swt_settings", JSON.stringify(STATE.settings));
  } catch (e) {}
};
window.STATE.restoreBootCache = function () {
  try {
    const ins = sessionStorage.getItem("swt_instructors");
    const set = sessionStorage.getItem("swt_settings");
    if (set) STATE.settings = JSON.parse(set);
    if (ins) {
      const parsed = JSON.parse(ins);
      // 예전 형식(배열)도 받아준다
      STATE.instructors = Array.isArray(parsed) ? parsed : (parsed.instructors || []);
      STATE.assignableNames = Array.isArray(parsed) ? parsed : (parsed.assignableNames || STATE.instructors);
      return STATE.instructors;
    }
  } catch (e) {}
  return null;
};
// 월별 데이터도 sessionStorage 캐시 (페이지 새로고침 후에도 즉시)
window.STATE.saveMonthCache = function (ym, data) {
  STATE.cache.monthData[ym] = data;
  try { sessionStorage.setItem("swt_month_" + ym, JSON.stringify(data)); } catch (e) {}
};
window.STATE.restoreMonthCache = function (ym) {
  if (STATE.cache.monthData[ym]) return STATE.cache.monthData[ym];
  try {
    const v = sessionStorage.getItem("swt_month_" + ym);
    if (v) {
      const d = JSON.parse(v);
      STATE.cache.monthData[ym] = d;
      return d;
    }
  } catch (e) {}
  return null;
};

// 배치 한 건의 시수.
// 서버가 hours 를 내려주지만, 시트에서 넘어온 과거 행은 해설/지원이 쪼개져
// 있을 수 있어 합계로 계산한다.
window.hoursOf = function (a) {
  if (a && a.hours !== undefined && a.hours !== null) return Number(a.hours) || 0;
  return Number((a && a.hExplain) || 0) + Number((a && a.hSupport) || 0) + Number((a && a.hResearch) || 0);
};

// 시수 표기 — 3, 3.5 처럼 필요한 만큼만
window.fmtH = function (n) {
  const r = Math.round(Number(n || 0) * 10) / 10;
  return r % 1 === 0 ? String(r) : r.toFixed(1);
};

// 한글 가나다 정렬 (기본 localeCompare(ko)로 충분).
window.sortKo = function (arr) {
  return arr.slice().sort((a, b) => a.localeCompare(b, "ko"));
};

// Boolean 안전 변환 (Google Sheets의 "TRUE"/"FALSE" 문자열도 처리)
window.isTrue = function (v) {
  if (v === true) return true;
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "y" || s === "yes";
};

// 강사 이름 HTML — 파견교사(이상우)는 주황색 강조
window.nameLabel = function (name) {
  const n = String(name == null ? "" : name);
  if (n === "이상우") return `<span class="name-emergency" title="파견교사">${n}</span>`;
  return n;
};

// 날짜 유틸
window.ymOf = function (d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
window.dateStr = function (d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
window.parseDate = function (s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
// 일요일을 주 시작으로 보고, 해당 주의 일요일 날짜 문자열.
window.weekStartSun = function (s) {
  const d = parseDate(s);
  d.setDate(d.getDate() - d.getDay());
  return dateStr(d);
};
window.todayYm = function () {
  return ymOf(new Date());
};
window.nextYm = function (ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return ymOf(d);
};
window.prevYm = function (ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return ymOf(d);
};
