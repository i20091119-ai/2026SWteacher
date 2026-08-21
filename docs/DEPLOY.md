# 배포 절차

구성은 두 조각입니다.

| 조각 | 무엇 | 어디에 |
|---|---|---|
| 프론트엔드 | `index.html` · `css/` · `js/` · `assets/` | GitHub Pages (정적) |
| 백엔드 + DB | `worker/` (Cloudflare Workers + D1) | Cloudflare (무료 요금제) |

> 예전의 구글시트 + Apps Script 백엔드는 더 이상 쓰지 않습니다.
> 시트에 남은 데이터를 옮기는 방법은 [MIGRATION.md](MIGRATION.md) 를 보세요.

---

## 0. 저장소와 Node.js 준비 (한 번만)

### Node.js 22 이상

Wrangler(Cloudflare 배포 도구)는 **Node.js 22 이상**을 요구합니다.
`node -v` 가 v22 미만이면 먼저 올려야 합니다.

```powershell
node -v                              # v22.x.x 이상이어야 함

# 낮으면 (Windows)
winget install OpenJS.NodeJS.LTS
# 또는 https://nodejs.org 에서 LTS 설치본 내려받기
```

> 설치 후 **PowerShell 창을 닫았다 다시 열어야** 새 버전이 잡힙니다.

### 저장소 내려받기

`cd worker` 는 저장소 폴더 안에서만 됩니다.
`C:\Users\...>` 같은 홈 폴더에서 실행하면 "경로를 찾을 수 없습니다" 가 납니다.

```powershell
cd $HOME\Documents
git clone https://github.com/i20091119-ai/2026SWteacher.git
cd 2026SWteacher
```

> `git` 이 없다면: `winget install Git.Git` 후 창을 다시 엽니다.

아직 작업 브랜치가 `main` 에 합쳐지기 전이라면 브랜치를 받아야 `worker` 폴더가 보입니다.

```powershell
git checkout claude/dedicated-database-migration-iw913y
dir                                  # worker 폴더가 보이면 정상
```

## 1. Cloudflare 준비 (한 번만)

1. https://dash.cloudflare.com 에서 무료 계정을 만듭니다.
2. **가입 메일의 인증 링크를 반드시 눌러 이메일을 인증합니다.**
   인증하지 않으면 배포 단계에서 이렇게 막힙니다.
   ```
   You need to verify your email address to use Workers.  [code: 10034]
   ```
   대시보드 상단에 인증 배너가 뜹니다. 메일이 안 보이면 스팸함을 확인하고,
   그래도 없으면 배너의 **Resend** 로 다시 받습니다.
3. 저장소 폴더 안에서:

```powershell
cd worker                   # 반드시 2026SWteacher 폴더 안에서
npm install
npx wrangler login          # 브라우저가 열리고 계정 연결을 승인
```

> 이후 2·4·5단계 명령은 **전부 `worker` 폴더 안에서** 실행합니다.
> 헷갈리면 `pwd` 로 현재 위치가 `...\2026SWteacher\worker` 인지 확인하세요.

## 2. 데이터베이스 만들기

```bash
npx wrangler d1 create swteacher-db
```

출력에 나오는 `database_id` (긴 영문+숫자 문자열)를 복사해
`worker/wrangler.toml` 의 `database_id` 자리에 붙여넣습니다.

> **`[[d1_databases]]` 블록을 통째로 붙여넣지 마세요.**
> wrangler 는 `binding = "swteacher_db"` 를 제안하지만, 코드는 `env.DB` 를 참조하므로
> `binding` 은 반드시 `"DB"` 로 두어야 합니다. **`database_id` 한 줄만** 바꾸면 됩니다.

```powershell
notepad wrangler.toml        # 메모장으로 열어서 고치고 저장
```

고친 뒤 이렇게 되어 있어야 합니다.

```toml
database_id = "1a2b3c4d-....-............"
```

이어서 표(스키마)와 초기 데이터를 넣습니다.

```bash
npm run db:schema     # 표 생성
npm run db:seed       # 강사 5명 · 단가 · 2026년 공휴일 · 최초 관리자
```

## 3. Google OAuth 클라이언트 ID

> 기존에 쓰던 클라이언트 ID 를 그대로 쓴다면 **아래 "필수 확인" 한 가지만** 하면 됩니다.
> 클라이언트 ID 는 `wrangler.toml` 과 `js/config.js` 양쪽에 이미 들어가 있습니다.

**필수 확인 — 승인된 자바스크립트 원본**

https://console.cloud.google.com → **사용자 인증 정보 > 해당 OAuth 클라이언트 ID** 를 열어,
**승인된 자바스크립트 원본** 에 GitHub Pages 주소가 있는지 봅니다.
없으면 추가하세요. 등록돼 있지 않으면 관리자 로그인이 실패합니다.

```
https://i20091119-ai.github.io
http://localhost:8787          (로컬 미리보기를 쓸 때만)
```

<details>
<summary>클라이언트 ID 를 새로 발급하는 경우</summary>

1. https://console.cloud.google.com → 프로젝트 선택/생성
2. **API 및 서비스 > OAuth 동의 화면** 구성. 테스트 사용자에 관리자 Google 계정 추가.
3. **사용자 인증 정보 > OAuth 클라이언트 ID > 웹 애플리케이션**
4. **승인된 자바스크립트 원본** 에 위 주소들을 등록
5. 발급된 ID 를 **두 곳 모두** 에 넣습니다 — `worker/wrangler.toml` 의 `GOOGLE_CLIENT_ID`,
   `js/config.js` 의 `GOOGLE_CLIENT_ID`.
   둘이 다르면 관리자 로그인이 "OAuth 클라이언트 ID가 일치하지 않습니다" 로 실패합니다.

</details>

## 4. 백엔드 배포

```powershell
npm run deploy
```

배포되면 `https://swteacher-api.<계정>.workers.dev` 같은 주소가 나옵니다.
브라우저로 그 주소를 열어 `{"ok":true,...,"db":true}` 가 보이면 정상입니다.

> 이 시점에는 아직 세션 키가 없어서 관리자 로그인만 실패합니다(5단계에서 등록).

## 5. 세션 서명 키 등록

`worker/wrangler.toml` 의 `[vars]` 두 값은 **이미 채워져 있습니다.** 그대로 두면 됩니다.
(아래 설명은 참고용이며, 손댈 것은 없습니다.)

- `GOOGLE_CLIENT_ID` — 기존에 쓰던 OAuth 클라이언트 ID
- `ALLOWED_ORIGINS` — `https://i20091119-ai.github.io`
  - 이 목록에 없는 사이트에서 온 요청은 막힙니다.
    **비우면 아무 사이트에서나 호출할 수 있으니 절대 비워두지 마세요.**

세션 서명 키만 등록하면 됩니다. 코드에 두지 말고 시크릿으로 넣습니다.
**워커를 먼저 배포한 뒤에 등록해야** 흐름이 꼬이지 않습니다(배포 없이 등록하면
wrangler 가 "워커를 새로 만들까요?" 를 먼저 묻습니다). 등록 즉시 반영되며 재배포는 필요 없습니다.

먼저 아무도 모르는 무작위 문자열을 만듭니다.

```powershell
# Windows PowerShell
$b = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)
```

```bash
# macOS / Linux
openssl rand -base64 32
```

출력된 문자열을 복사한 뒤:

```powershell
npx wrangler secret put SESSION_SECRET
# Enter a secret value: 라고 물으면 붙여넣고 Enter
# (입력한 글자는 화면에 보이지 않습니다 — 정상입니다)
```

> `SESSION_SECRET` 을 바꾸면 이미 로그인한 사람들의 세션이 모두 끊깁니다(다시 로그인하면 됨).
> 한 번 등록하면 다시 볼 수 없으니, 따로 적어두실 필요는 없지만 재등록은 언제든 가능합니다.

## 6. 프론트엔드 연결 + 배포

`js/config.js` 의 `API_ENDPOINT` 에 4단계에서 나온 워커 주소를 넣습니다.

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
- [ ] 강사 페이지: 달력에서 날짜 클릭 시 활동불가일이 **즉시** 표시됨
- [ ] 관리자 페이지: 캘린더 칸의 `+ 추가` 로 배치 저장
- [ ] 주간 합계 표가 상한(20h) 초과 주를 빨강으로 표시
- [ ] 학생 프로그램이 캘린더에 표시되는지
- [ ] 확정 공개를 켠 뒤 강사 화면에 활동표가 보이는지
- [ ] 공개 후 강사가 수업 교체를 신청하고, 관리자가 승인하면 담당이 바뀌는지
