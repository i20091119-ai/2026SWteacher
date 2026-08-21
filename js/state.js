// 전역 상태(브라우저 메모리). 새로고침 시 sessionStorage로 복원.
window.STATE = {
  user: null,            // { role:'instructor'|'admin', name?:string, email?:string }
  sessionToken: null,    // 서버가 발급한 세션 토큰 (HMAC 서명, 12시간)
  instructors: [],       // 가나다순 (순번 계산 기준) — 서버가 정렬해 내려준다
  assignableNames: [],   // 배치 가능한 전체 이름 (순번에 넣지 않는 파견교사 포함)
  settings: {},          // rate.explain / rate.other / weeklyCap
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
  try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  if (window.api && api.clearCache) api.clearCache();
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
