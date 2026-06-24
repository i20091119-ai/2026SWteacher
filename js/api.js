// GAS 웹앱 호출 래퍼. CORS preflight 회피를 위해 text/plain로 보낸다.
// 읽기 액션은 한 번 timeout 시 자동 재시도 (콜드 스타트/캐시 미스 대응).
const _READ_ACTIONS = new Set(["bootstrap", "getMonth", "getCarryover"]);
const _LONG_TIMEOUT_MS = 90000;
const _SHORT_TIMEOUT_MS = 45000;

async function _doFetch(body, timeoutMs) {
  const endpoint = APP_CONFIG.GAS_ENDPOINT;
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  const canRetry = _READ_ACTIONS.has(action);
  const timeoutMs = canRetry ? _LONG_TIMEOUT_MS : _SHORT_TIMEOUT_MS;
  const maxAttempts = canRetry ? 2 : 1;

  let res;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      res = await _doFetch(body, timeoutMs);
      break;
    } catch (e) {
      if (e && e.name === "AbortError") {
        if (attempt < maxAttempts) {
          console.warn(`[api] ${action} 타임아웃 (${timeoutMs/1000}s), 재시도 ${attempt + 1}/${maxAttempts}`);
          continue;
        }
        throw new Error(`GAS 응답이 ${timeoutMs / 1000}초 내에 오지 않았습니다 (action=${action}, 시도=${attempt}). GAS 배포 상태/네트워크를 확인하세요.`);
      }
      if (canRetry && attempt < maxAttempts) {
        console.warn(`[api] ${action} 네트워크 오류, 재시도 ${attempt + 1}/${maxAttempts}:`, e.message);
        continue;
      }
      throw new Error("네트워크 오류 (GAS 호출 실패): " + e.message);
    }
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
  if (!json.ok) {
    const msg = json.error || "요청 실패";
    if (json.stack) console.error("[GAS stack]", json.stack);
    throw new Error(msg);
  }
  return json.data;
};

// 자주 쓰는 호출들
window.API = {
  bootstrap: () => api("bootstrap"),
  getMonth: (ym) => api("getMonth", { ym }),
  getCarryover: (ym) => api("getCarryover", { ym }),
  saveUnavailable: (date, on) => api("saveUnavailable", { date, on }),
  submitUnavailable: (ym, submitted) => api("submitUnavailable", { ym, submitted }),
  saveAssignment: (a) => api("saveAssignment", a),
  saveAssignmentsBatch: (assignments) => api("saveAssignmentsBatch", { assignments }),
  deleteAssignment: (id) => api("deleteAssignment", { id }),
  setSeed: (ym, kind, pointer) => api("setSeed", { ym, kind, pointer }),
  setSetting: (key, value) => api("setSetting", { key, value }),
  createSwap: (assignmentId, target, note) => api("createSwap", { assignmentId, target, note }),
  cancelSwap: (swapId) => api("cancelSwap", { swapId }),
  approveSwap: (swapId) => api("approveSwap", { swapId }),
  rejectSwap: (swapId) => api("rejectSwap", { swapId }),
  createProgram: (p) => api("createProgram", p),
  updateProgram: (p) => api("updateProgram", p),
  deleteProgram: (id) => api("deleteProgram", { id }),
};
