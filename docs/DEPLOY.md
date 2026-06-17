# 배포 절차

## 1. Google Cloud — OAuth 2.0 클라이언트 ID 생성

1. https://console.cloud.google.com 에서 프로젝트 생성(또는 기존 사용).
2. **API 및 서비스 > OAuth 동의 화면** 에서 외부(External) 동의 화면 구성. 테스트 사용자에 관리자 Google 계정(`i20091119@gmail.com`) 추가.
3. **사용자 인증 정보 > 사용자 인증 정보 만들기 > OAuth 클라이언트 ID** 선택, 애플리케이션 유형은 **웹 애플리케이션**.
4. **승인된 자바스크립트 원본**에 GitHub Pages 배포 주소를 등록.
   - 예) `https://i20091119-ai.github.io` (사용자 페이지) 또는 `https://i20091119-ai.github.io/2026swteacher` 로 호스팅한다면 `https://i20091119-ai.github.io` 도메인.
   - 로컬 테스트가 필요하면 `http://localhost:5500` 등 추가.
5. 발급된 **클라이언트 ID**를 복사 (`xxxxx.apps.googleusercontent.com`).

## 2. GAS 웹앱 배포

1. https://script.google.com 에서 **새 프로젝트** 생성.
2. `gas/Code.gs` 내용을 그대로 복사해 붙여넣기.
3. 상단의 상수 두 개를 수정:
   - `SHEET_ID` — 시트 ID (기본값으로 이미 채워져 있음).
   - `GOOGLE_OAUTH_CLIENT_ID` — 1단계에서 발급받은 클라이언트 ID.
4. 메뉴 **배포 > 새 배포** → 유형 **웹앱**.
   - 설명: `swteacher-api`
   - **다음 사용자로 실행: 본인(=시트 소유자)**
   - **액세스 권한: 모든 사용자**
5. 처음 배포 시 권한 요청을 승인. 외부 OAuth 동의 화면이 검증 전 상태일 수 있으므로 *고급 > 안전하지 않은 페이지로 이동* 진행.
6. 배포 후 **웹앱 URL**(`.../exec`)을 복사.

## 3. 프론트엔드 설정

`js/config.js` 를 열어 두 값 입력:

```js
window.APP_CONFIG = {
  GAS_ENDPOINT: "https://script.google.com/macros/s/AKfycb.../exec",
  GOOGLE_CLIENT_ID: "1234567890-xxxx.apps.googleusercontent.com",
  ADMIN_HINT: "i20091119@gmail.com",
};
```

## 4. GitHub Pages 배포

1. 저장소 `i20091119-ai/2026swteacher` 의 **Settings > Pages**.
2. **Branch**: `main` (또는 본 작업 브랜치를 main에 머지한 후), 폴더 `/ (root)` 선택.
3. 배포 URL을 1단계의 *승인된 자바스크립트 원본* 에 반드시 등록되어 있는지 재확인.

## 5. 시트 초기 시드

GAS 첫 호출 시 자동 시드:
- `강사`: 5명(가나다순)
- `설정`: `rate.explain=30000`, `rate.other=20000`, `weeklyCap=14`, `admin.whitelist=i20091119@gmail.com`
- `순번시드`: `2026-06 가족체험=0`, `2026-06 주말어드벤처=2`

이후 추가 관리자, 휴관일, 일정 확정 공개(`publish.YYYY-MM=1`)는 시트 또는 향후 관리자 UI에서 직접 갱신.

## 6. 동작 확인 체크리스트

- [ ] 로그인 페이지에 강사 5명 버튼 표시.
- [ ] Google 로그인 → 화이트리스트 계정만 관리자 진입.
- [ ] 강사 페이지: 달력에서 날짜 클릭 시 불가일 토글 및 즉시 반영.
- [ ] 관리자 페이지: 캘린더에서 `+ 추가` 모달로 배치 저장.
- [ ] 주간 합계 표가 14h 초과를 빨강으로 표시.
- [ ] 장부 뷰에서 해설이 잘려 14h를 넘지 않는지.
- [ ] 다음 달로 이동했을 때 *전월 이월 안내* 가 표시되는지.
- [ ] 강사 제출 후 다른 단말에서 새로고침했을 때 동시성 충돌 없이 반영되는지.
