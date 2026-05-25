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
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
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
