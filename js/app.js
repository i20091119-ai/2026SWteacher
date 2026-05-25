window.App = {
  async boot() {
    Auth.init();
    STATE.restore();
    try {
      const boot = await API.bootstrap();
      STATE.instructors = sortKo(boot.instructors || []);
      STATE.settings = boot.settings || {};
      Auth.renderInstructorButtons(STATE.instructors);
      Ledger.syncRates();
    } catch (e) {
      console.error(e);
      document.getElementById("instructorButtons").innerHTML =
        `<div class="muted">데이터를 불러오지 못했습니다: ${e.message}</div>`;
    }
    // GSI 스크립트가 늦게 로드될 수 있어 약간 지연
    const tryGsi = () => { if (window.google && google.accounts) Auth.initGoogle(); else setTimeout(tryGsi, 250); };
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
