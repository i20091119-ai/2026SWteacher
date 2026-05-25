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
  try { sessionStorage.removeItem("swt_user"); } catch (e) {}
};

// 한글 가나다 정렬 (기본 localeCompare(ko)로 충분).
window.sortKo = function (arr) {
  return arr.slice().sort((a, b) => a.localeCompare(b, "ko"));
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
