/**
 * 백엔드(Cloudflare Workers + D1) 호출 래퍼.
 *
 * 시트 백엔드 시절과 달라진 점
 *  - 응답이 수십 ms 수준이라 타임아웃을 15초 → 10초로 줄였다.
 *  - 같은 요청이 겹치면 하나로 합친다(중복 클릭 방어).
 *  - 조회 결과를 아주 짧게 캐시해 화면 재렌더가 왕복을 다시 만들지 않게 한다.
 *  - 네트워크 오류는 한 번 자동 재시도한다.
 */
(function () {
  const inflight = new Map();   // key -> Promise
  const cache = new Map();      // key -> { at, data }
  const CACHE_MS = 1500;
  const READ_ACTIONS = new Set(["bootstrap", "getMonth", "getAdminMonth"]);

  function endpoint() {
    const url = (APP_CONFIG.API_ENDPOINT || "").replace(/\/+$/, "");
    if (!url || url.includes("REPLACE_ME")) {
      throw new Error("API_ENDPOINT가 설정되지 않았습니다. js/config.js를 수정하세요.");
    }
    return url;
  }

  async function send(action, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), APP_CONFIG.TIMEOUT_MS || 10000);
    const headers = { "Content-Type": "application/json" };
    const token = STATE.sessionToken;
    if (token) headers.Authorization = "Bearer " + token;
    try {
      const res = await fetch(endpoint() + "/api", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          action,
          payload: payload || {},
          // 세션 토큰을 아직 못 받은 첫 요청을 위한 보조 경로
          auth: STATE.user ? { role: STATE.user.role, name: STATE.user.name || null } : null,
        }),
      });
      let json = null;
      try { json = await res.json(); } catch (e) { /* 아래에서 처리 */ }
      if (!json) throw new Error(`서버 응답을 해석할 수 없습니다 (HTTP ${res.status})`);
      if (!json.ok) {
        const err = new Error(json.error || `요청 실패 (HTTP ${res.status})`);
        err.status = res.status;
        throw err;
      }
      return json.data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("응답 시간 초과");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  window.api = async function (action, payload) {
    const key = action + ":" + JSON.stringify(payload || {});
    const readable = READ_ACTIONS.has(action);

    if (readable) {
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    }
    if (inflight.has(key)) return inflight.get(key);

    const run = (async () => {
      let lastErr;
      // 네트워크 계층 실패만 재시도한다 (400/403 같은 논리 오류는 즉시 던진다).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await send(action, payload);
          if (readable) cache.set(key, { at: Date.now(), data });
          else cache.clear(); // 쓰기가 일어나면 읽기 캐시를 버린다
          return data;
        } catch (e) {
          lastErr = e;
          if (e.status === 401) {
            STATE.clear();
            if (location.hash !== "#login") {
              location.hash = "#login";
              location.reload();
            }
            throw e;
          }
          if (e.status) throw e;          // 서버가 이유를 말해준 오류 → 재시도 무의미
          if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
        }
      }
      throw lastErr;
    })();

    inflight.set(key, run);
    try {
      return await run;
    } finally {
      inflight.delete(key);
    }
  };

  window.api.clearCache = () => cache.clear();

  window.API = {
    bootstrap: () => api("bootstrap"),
    loginInstructor: (name) => api("loginInstructor", { name }),
    verifyAdmin: (idToken) => api("verifyAdmin", { idToken }),

    getMonth: (ym) => api("getMonth", { ym }),
    getAdminMonth: (ym) => api("getAdminMonth", { ym }),

    saveUnavailable: (date, on, reason) => api("saveUnavailable", { date, on, reason }),
    submitUnavailable: (ym, submitted) => api("submitUnavailable", { ym, submitted }),

    saveAssignment: (a) => api("saveAssignment", a),
    deleteAssignment: (id) => api("deleteAssignment", { id }),
    setSetting: (key, value) => api("setSetting", { key, value }),
    addInstructor: (name) => api("addInstructor", { name }),
    removeInstructor: (name) => api("removeInstructor", { name }),
    setHoliday: (date, on, label) => api("setHoliday", { date, on, label }),
    setPublished: (ym, published) => api("setPublished", { ym, published }),
    exportAll: () => api("exportAll"),
  };

  /** 헬스체크 — 진단 배너에서 사용 */
  window.apiHealth = async function () {
    const res = await fetch(endpoint() + "/health");
    return res.json();
  };
})();
