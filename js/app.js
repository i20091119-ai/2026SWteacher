window.DIAG = { logs: [], result: null, error: null };
window.dlog = function (s) {
  const t = new Date().toISOString().substring(11, 19);
  DIAG.logs.push(`[${t}] ${s}`);
  const panel = document.getElementById("diagPanel");
  if (panel) panel.textContent = DIAG.logs.join("\n");
  console.log("[swt]", s);
};

window.setStatus = function (kind, msg) {
  const bar = document.getElementById("statusBar");
  const text = document.getElementById("statusText");
  if (!bar) return;
  bar.classList.remove("loading", "ok", "err");
  bar.classList.add(kind);
  text.textContent = msg;
};

window.App = {
  async boot() {
    Auth.init();
    STATE.restore();
    setStatus("loading", "GAS 연결 중...");
    document.getElementById("retryBtn").onclick = () => App.bootData();
    document.getElementById("diagBtn").onclick = () => {
      document.getElementById("diagPanel").classList.toggle("hidden");
    };
    dlog("GAS_ENDPOINT: " + APP_CONFIG.GAS_ENDPOINT);
    dlog("GOOGLE_CLIENT_ID: " + APP_CONFIG.GOOGLE_CLIENT_ID);
    await App.bootData();
    const tryGsi = (n = 0) => {
      if (window.google && google.accounts) {
        dlog("GSI 로드 완료, 버튼 렌더");
        Auth.initGoogle();
      } else if (n < 40) {
        setTimeout(() => tryGsi(n + 1), 250);
      } else {
        dlog("GSI 라이브러리가 로드되지 않음 (광고 차단/네트워크)");
      }
    };
    tryGsi();
    window.addEventListener("hashchange", App.route);
    App.route();
  },

  async bootData() {
    document.getElementById("retryBtn").classList.add("hidden");
    setStatus("loading", "강사 명단 불러오는 중...");
    dlog("bootstrap 요청 시작");
    try {
      const boot = await Promise.race([
        API.bootstrap(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("응답 시간 초과 (15초)")), 15000)),
      ]);
      dlog("bootstrap 응답: " + JSON.stringify(boot));
      STATE.instructors = sortKo(boot.instructors || []);
      STATE.settings = boot.settings || {};
      Auth.renderInstructorButtons(STATE.instructors);
      Ledger.syncRates();
      if (!STATE.instructors.length) {
        setStatus("err", "강사 명단이 비어있습니다. 시트 `강사` 탭에 5명이 자동 시드되지 않은 상태입니다.");
        document.getElementById("retryBtn").classList.remove("hidden");
      } else {
        setStatus("ok", `정상 · 강사 ${STATE.instructors.length}명 로드됨`);
      }
    } catch (e) {
      dlog("bootstrap 실패: " + e.message);
      setStatus("err", "연결 실패: " + e.message);
      document.getElementById("instructorButtons").innerHTML =
        `<div class="muted">데이터를 불러오지 못했습니다.<br>오른쪽 상단 [진단 정보] 버튼을 눌러 로그를 확인하세요.</div>`;
      document.getElementById("retryBtn").classList.remove("hidden");
    }
  },

  route() {
    const hash = location.hash || "#login";
    const topbar = document.getElementById("topbar");
    document.querySelectorAll(".page").forEach((p) => p.classList.add("hidden"));
    if (!STATE.user && hash !== "#login") { location.hash = "#login"; return; }
    if (hash === "#instructor") {
      if (!STATE.user || STATE.user.role !== "instructor") { location.hash = "#login"; return; }
      topbar.classList.remove("hidden");
      document.getElementById("page-instructor").classList.remove("hidden");
      Instructor.render().catch((e) => alert(e.message));
    } else if (hash === "#admin") {
      if (!STATE.user || STATE.user.role !== "admin") { location.hash = "#login"; return; }
      topbar.classList.remove("hidden");
      document.getElementById("page-admin").classList.remove("hidden");
      Admin.render().catch((e) => alert(e.message));
    } else {
      topbar.classList.add("hidden");
      document.getElementById("page-login").classList.remove("hidden");
    }
  },
};
window.addEventListener("error", (e) => {
  dlog("JS 에러: " + (e.error && e.error.message || e.message));
});
document.addEventListener("DOMContentLoaded", App.boot);
