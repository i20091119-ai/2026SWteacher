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
    names.forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = n;
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          // 이름이 실제 명단에 있는지 서버가 확인하고 세션 토큰을 발급한다.
          const d = await API.loginInstructor(n);
          STATE.user = { role: "instructor", name: d.name };
          STATE.sessionToken = d.sessionToken;
          STATE.save();
          location.hash = "#instructor";
          App.route();
        } catch (e) {
          alert("로그인 실패: " + e.message);
        } finally {
          b.disabled = false;
        }
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
    const msg = document.getElementById("adminLoginMsg");
    msg.textContent = "관리자 인증 중...";
    try {
      // 서버가 Google ID 토큰의 서명을 직접 검증한 뒤 자체 세션 토큰을 발급한다.
      // 이후 요청은 Google 왕복 없이 로컬 서명 확인만 거친다.
      const d = await API.verifyAdmin(resp.credential);
      STATE.user = { role: "admin", email: d.email };
      STATE.sessionToken = d.sessionToken;
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
