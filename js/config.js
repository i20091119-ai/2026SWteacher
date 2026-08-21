// 배포 시 아래 값을 채워 넣으세요. docs/DEPLOY.md 참고.
window.APP_CONFIG = {
  // Cloudflare Workers 백엔드 주소
  API_ENDPOINT: (location.hostname === "localhost" || location.hostname === "127.0.0.1")
    ? location.origin                                    // 로컬 미리보기 (tools/dev-server.mjs)
    : "https://swteacher-api.gnmc-swteacher.workers.dev",
  // Google Cloud Console에서 발급한 OAuth 2.0 클라이언트 ID (웹 애플리케이션)
  GOOGLE_CLIENT_ID: "79888472929-34mqbk6lr9d5b6j7ugmommpie75ak98i.apps.googleusercontent.com",
  // 관리자 화이트리스트는 DB(admins 테이블)에서 관리하며, 클라이언트는 안내만 표시함.
  ADMIN_HINT: "i20091119@gmail.com",
  // 요청 타임아웃(ms)
  TIMEOUT_MS: 10000,
};
