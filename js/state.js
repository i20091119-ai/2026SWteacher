// 전역 상태(브라우저 메모리). 새로고침 시 sessionStorage로 복원.
window.STATE = {
  user: null,            // { role:'instructor'|'admin', name?:string, email?:string, idToken?:string }
  instructors: [],       // ['김경화','신미정','이경향','이윤미']  (가나다순으로 정렬해 저장)
  settings: {},          // 시트 '설정' 키-값
  cache: {
    monthData: {},       // ym -> {assignments, unavails, submits, holidays, seeds, carryovers}
  },
};

window.STATE.save = function () {
  try {
    sessionStorage.setItem("swt_user", JSON.stringify(STATE.user));
  } catch (e) {}
};
window.STATE.restore = function () {
  try {
    const u = sessionStorage.getItem("swt_user");
    if (u) STATE.user = JSON.parse(u);
  } catch (e) {}
};
window.STATE.clear = function () {
  STATE.user = null;
  try {
    sessionStorage.removeItem("swt_user");
    sessionStorage.removeItem("swt_instructors");
    sessionStorage.removeItem("swt_settings");
  } catch (e) {}
};
// 강사 목록/설정을 sessionStorage에 캐시 (페이지 새로고침 시 즉시 표시 + 백그라운드 refresh)
window.STATE.saveBootCache = function () {
  try {
    sessionStorage.setItem("swt_instructors", JSON.stringify(STATE.instructors));
    sessionStorage.setItem("swt_settings", JSON.stringify(STATE.settings));
  } catch (e) {}
};
window.STATE.restoreBootCache = function () {
  try {
    const ins = sessionStorage.getItem("swt_instructors");
    const set = sessionStorage.getItem("swt_settings");
    if (set) STATE.settings = JSON.parse(set);
    if (ins) {
      STATE.instructors = JSON.parse(ins);
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
