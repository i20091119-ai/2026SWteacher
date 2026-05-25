// GAS 웹앱 호출 래퍼. CORS preflight 회피를 위해 text/plain로 보낸다.
window.api = async function (action, payload) {
  const endpoint = APP_CONFIG.GAS_ENDPOINT;
  if (!endpoint || endpoint.includes("REPLACE_ME")) {
    throw new Error("GAS_ENDPOINT가 설정되지 않았습니다. js/config.js를 수정하세요.");
  }
  const body = {
    action,
    payload: payload || {},
    auth: STATE.user
      ? { role: STATE.user.role, name: STATE.user.name || null, idToken: STATE.user.idToken || null }
      : null,
  };
  let res;
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined,
    });
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new Error(`GAS 응답이 20초 내에 오지 않았습니다 (action=${action}). GAS 배포 상태/네트워크를 확인하세요.`);
    }
    throw new Error("네트워크 오류 (GAS 호출 실패): " + e.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} (action=${action})`);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const looksLikeLogin = text.indexOf("<html") !== -1 || text.indexOf("accounts.google.com") !== -1;
    if (looksLikeLogin) {
      throw new Error("GAS가 로그인 페이지를 반환했습니다. 배포 시 '액세스 권한: 모든 사용자'로 새 배포를 만들고 GAS_ENDPOINT를 갱신하세요.");
    }
    throw new Error("GAS 응답이 JSON이 아닙니다: " + text.slice(0, 200));
  }
  if (!json.ok) throw new Error(json.error || "요청 실패");
  return json.data;
};

// 자주 쓰는 호출들
window.API = {
  bootstrap: () => api("bootstrap"),
  getMonth: (ym) => api("getMonth", { ym }),
  getCarryover: (ym) => api("getCarryover", { ym }),
  saveUnavailable: (date, on, reason) => api("saveUnavailable", { date, on, reason }),
  submitUnavailable: (ym, submitted) => api("submitUnavailable", { ym, submitted }),
  saveAssignment: (a) => api("saveAssignment", a),
  deleteAssignment: (id) => api("deleteAssignment", { id }),
  setSeed: (ym, kind, pointer) => api("setSeed", { ym, kind, pointer }),
  setSetting: (key, value) => api("setSetting", { key, value }),
};
