# 배포 절차

구성은 두 조각입니다.

| 조각 | 무엇 | 어디에 |
|---|---|---|
| 프론트엔드 | `index.html` · `css/` · `js/` · `assets/` | GitHub Pages (정적) |
| 백엔드 + DB | `worker/` (Cloudflare Workers + D1) | Cloudflare (무료 요금제) |

> 예전의 구글시트 + Apps Script 백엔드는 더 이상 쓰지 않습니다.
> 시트에 남은 데이터를 옮기는 방법은 [MIGRATION.md](MIGRATION.md) 를 보세요.

---

## 1. Cloudflare 준비 (한 번만)

1. https://dash.cloudflare.com 에서 무료 계정을 만듭니다.
2. 컴퓨터에 Node.js 18 이상을 설치합니다.
3. 터미널에서:

```bash
cd worker
npm install
npx wrangler login          # 브라우저가 열리고 계정 연결을 승인
```

## 2. 데이터베이스 만들기

```bash
npx wrangler d1 create swteacher-db
```

출력에 나오는 `database_id` 를 복사해 `worker/wrangler.toml` 의
`database_id = "PASTE_DATABASE_ID_HERE"` 자리에 붙여넣습니다.

이어서 표(스키마)와 초기 데이터를 넣습니다.

```bash
npm run db:schema     # 표 생성
npm run db:seed       # 강사 5명 · 단가 · 2026년 공휴일 · 최초 관리자
```

## 3. 설정값 넣기

`worker/wrangler.toml` 의 `[vars]`:

- `GOOGLE_CLIENT_ID` — 아래 4단계에서 발급받는 값
- `ALLOWED_ORIGINS` — GitHub Pages 주소. 예: `https://i20091119-ai.github.io`
  - **비워두면 아무 사이트에서나 API 를 호출할 수 있습니다. 반드시 채우세요.**

세션 서명 키는 코드에 두지 말고 시크릿으로 등록합니다.

```bash
# 아무도 모르는 긴 무작위 문자열. 아래처럼 만들어 붙여넣으면 됩니다.
openssl rand -base64 32
npx wrangler secret put SESSION_SECRET
```

> `SESSION_SECRET` 을 바꾸면 이미 로그인한 사람들의 세션이 모두 끊깁니다(다시 로그인하면 됨).

## 4. Google OAuth 클라이언트 ID

1. https://console.cloud.google.com → 프로젝트 선택/생성
2. **API 및 서비스 > OAuth 동의 화면** 구성. 테스트 사용자에 관리자 Google 계정 추가.
3. **사용자 인증 정보 > OAuth 클라이언트 ID > 웹 애플리케이션**
4. **승인된 자바스크립트 원본** 에 GitHub Pages 주소를 등록
   (예: `https://i20091119-ai.github.io`, 로컬 테스트용 `http://localhost:8787`)
5. 발급된 클라이언트 ID를 **두 곳**에 넣습니다.
   - `worker/wrangler.toml` 의 `GOOGLE_CLIENT_ID`
   - `js/config.js` 의 `GOOGLE_CLIENT_ID`

## 5. 백엔드 배포

```bash
cd worker
npm run deploy
```

배포되면 `https://swteacher-api.<계정>.workers.dev` 같은 주소가 나옵니다.
브라우저로 그 주소를 열어 `{"ok":true,...,"db":true}` 가 보이면 정상입니다.

## 6. 프론트엔드 연결 + 배포

`js/config.js` 의 `API_ENDPOINT` 에 5단계 주소를 넣습니다.

```js
API_ENDPOINT: (location.hostname === "localhost" || location.hostname === "127.0.0.1")
  ? location.origin
  : "https://swteacher-api.<계정>.workers.dev",
```

그리고 저장소 **Settings > Pages** 에서 브랜치를 `main`, 폴더를 `/ (root)` 로 지정합니다.

## 7. 관리자 추가

최초 관리자는 `seed.sql` 에 들어있습니다. 더 추가하려면:

```bash
cd worker
npx wrangler d1 execute swteacher-db --remote \
  --command "INSERT OR IGNORE INTO admins (email) VALUES ('someone@example.com')"
```

---

## 로컬에서 미리 보기

Cloudflare 에 올리지 않고도 화면과 동작을 확인할 수 있습니다.
메모리 SQLite 위에 워커 코드를 그대로 얹어 띄웁니다.

```bash
node tools/dev-server.mjs        # http://localhost:8787
```

## 백엔드 테스트

```bash
cd worker
npm test        # 실제 SQLite 에 스키마를 올리고 API 전체를 검증
```

## 백업

```bash
cd worker
npx wrangler d1 export swteacher-db --remote --output backup.sql
```

관리자로 로그인한 상태에서 `exportAll` 액션을 호출해 JSON 으로 받을 수도 있습니다.

---

## 동작 확인 체크리스트

- [ ] `https://<워커주소>/health` 가 `"db": true` 를 반환
- [ ] 로그인 페이지에 강사 5명 버튼 표시
- [ ] Google 로그인 → `admins` 표에 있는 계정만 관리자 진입
- [ ] 강사 페이지: 달력에서 날짜 클릭 시 불가일이 **즉시** 표시됨
- [ ] 관리자 페이지: 캘린더 칸의 `+ 추가` 로 배치 저장
- [ ] 주간 합계 표가 상한 초과 주를 빨강으로 표시
- [ ] 장부 뷰에서 해설이 잘려 상한을 넘지 않는지
- [ ] 확정 공개를 켠 뒤 강사 화면에 근무표가 보이는지
