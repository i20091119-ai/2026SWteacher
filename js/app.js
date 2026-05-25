window.App = {
  async boot() {
    Auth.init();
    STATE.restore();
    const btnWrap = document.getElementById("instructorButtons");
    btnWrap.innerHTML = '<div class="muted">강사 목록을 불러오는 중...</div>';
    try {
      const boot = await API.bootstrap();
      STATE.instructors = sortKo(boot.instructors || []);
      STATE.settings = boot.settings || {};
      if (!STATE.instructors.length) {
        btnWrap.innerHTML = '<div class="muted">등록된 강사가 없습니다. 관리자에게 문의하세요.</div>';
      } else {
        Auth.renderInstructorButtons(STATE.instructors);
      }
      Ledger.syncRates();
    } catch (e) {
      console.error("bootstrap 실패", e);
      btnWrap.innerHTML =
        `<div class="muted">데이터를 불러오지 못했습니다: ${e.message}</div>` +
        `<button type="button" id="retryBoot">다시 시도</button>`;
      document.getElementById("retryBoot").onclick = () => location.reload();
    }
    // GSI 스크립트 로드 대기 (최대 약 10초)
    const adminMsg = document.getElementById("adminLoginMsg");
    adminMsg.textContent = "Google 로그인 준비 중...";
    let tries = 0;
    const tryGsi = () => {
      if (window.google && google.accounts) {
        adminMsg.textContent = "";
        Auth.initGoogle();
        return;
      }
      if (++tries > 40) {
        adminMsg.textContent = "Google 로그인 스크립트를 불러오지 못했습니다. 네트워크/광고 차단을 확인하세요.";
        return;
      }
      setTimeout(tryGsi, 250);
    };
    tryGsi();
    window.addEventListener("hashchange", App.route);
    App.route();
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
document.addEventListener("DOMContentLoaded", App.boot);
