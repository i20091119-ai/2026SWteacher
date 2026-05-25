// 강사 / 관리자 로그인 처리
window.Auth = {
  init() {
    document.getElementById("logoutBtn").addEventListener("click", () => {
      STATE.clear();
      location.hash = "#login";
      location.reload();
    });
  },
  renderInstructorButtons(names) {
    const wrap = document.getElementById("instructorButtons");
    wrap.innerHTML = "";
    sortKo(names).forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = n;
      b.addEventListener("click", () => {
        STATE.user = { role: "instructor", name: n };
        STATE.save();
        location.hash = "#instructor";
        App.route();
      });
      wrap.appendChild(b);
    });
  },
  initGoogle() {
    if (!window.google || !google.accounts) return;
    if (!APP_CONFIG.GOOGLE_CLIENT_ID || APP_CONFIG.GOOGLE_CLIENT_ID.includes("REPLACE_ME")) {
      document.getElementById("adminLoginMsg").textContent =
        "GOOGLE_CLIENT_ID가 설정되지 않았습니다. js/config.js를 수정하세요.";
      return;
    }
    google.accounts.id.initialize({
      client_id: APP_CONFIG.GOOGLE_CLIENT_ID,
      callback: Auth.onGoogleCredential,
    });
    google.accounts.id.renderButton(document.getElementById("g_id_signin"), {
      theme: "outline",
      size: "large",
      text: "signin_with",
    });
  },
  async onGoogleCredential(resp) {
    const idToken = resp.credential;
    const msg = document.getElementById("adminLoginMsg");
    msg.textContent = "관리자 인증 중...";
    try {
      // 토큰을 임시 user에 담아 서버에 검증 요청
      STATE.user = { role: "admin", idToken };
      const data = await api("verifyAdmin", {});
      STATE.user = { role: "admin", email: data.email, idToken };
      STATE.save();
      msg.textContent = "";
      location.hash = "#admin";
      App.route();
    } catch (e) {
      STATE.clear();
      msg.textContent = "관리자 로그인 실패: " + e.message;
    }
  },
};
