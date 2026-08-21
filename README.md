# 경남수학문화관 2026 SW해설강사 일정 관리

GitHub Pages(정적 프론트엔드) + **Cloudflare Workers + D1**(전용 데이터베이스) 구조의 근무 일정 관리 웹앱.

## 빠른 시작

1. [`docs/DEPLOY.md`](docs/DEPLOY.md) — Cloudflare D1 생성 · 워커 배포 · Google OAuth 설정
2. [`docs/MIGRATION.md`](docs/MIGRATION.md) — 기존 구글시트 데이터 옮기기
3. 로컬 미리보기: `node tools/dev-server.mjs` → http://localhost:8787

## 디렉터리

| 경로 | 설명 |
|---|---|
| `index.html` · `css/` · `js/` · `assets/` | 정적 프론트엔드 |
| `worker/` | 백엔드 (Cloudflare Workers) + `schema.sql` / `seed.sql` + 테스트 |
| `tools/dev-server.mjs` | 로컬 미리보기 서버 (워커 코드 + 메모리 SQLite) |
| `tools/migrate.html` | 구글시트 → 새 DB 이관 도구 |
| `gas/Code.gs` | 구 Apps Script 백엔드 — **이관 목적으로만 남아있음** |
| `docs/` | 배포 · 이관 · DB 구조 문서 |

## 핵심 개념

- **실제 근무 뷰**: 강사가 실제로 근무한 일정. 주 합계가 상한(기본 14h)을 넘으면 빨강 경고.
- **장부 뷰**: 외부 수당 장부에 옮겨 적을 화면. 주 단위로 연구·지원을 먼저 채우고,
  해설은 주 합계가 상한을 넘지 않도록 잘라냅니다.
- **확정 공개**: 관리자가 월별로 켜야 강사 화면에 확정 근무표가 보입니다.
- **인증**: 강사는 이름 선택(서버가 명단 대조 후 세션 발급),
  관리자는 Google ID 토큰을 워커에서 직접 서명 검증한 뒤 `admins` 표와 대조.

## 왜 전용 DB 로 옮겼나

구글시트 + Apps Script 백엔드에는 구조적인 문제가 있었습니다.

- `ensureTabs → seedDefaultsIfEmpty → readSettings → ensureTabs` 무한 재귀.
  스택이 터질 때까지 시트를 반복해 읽고, 그 예외를 빈 `catch` 가 삼켰습니다.
  **모든 API 호출**이 이 경로를 지났습니다.
- 월 조회가 탭 전체를 읽어 자바스크립트로 거르는 방식이라 데이터가 쌓일수록 느려졌습니다.
- 모든 저장이 "전체 읽기 → 행 번호 찾기 → 한 줄 쓰기" 였습니다.
- 관리자 화면은 한 번 그릴 때 월 조회를 두 번 했습니다.
- 관리자 인증이 요청마다 Google 서버로 왕복했습니다.

지금은:

| | 이전 | 이후 |
|---|---|---|
| 저장소 | 구글 스프레드시트 | D1 (SQLite), 월 조회에 인덱스 |
| 월 조회 | 탭 전체 스캔 | 인덱스 범위 스캔, 배치 1회 |
| 관리자 화면 로딩 | 왕복 2회 | 왕복 1회 |
| 관리자 인증 | 매 요청 Google 왕복 | 최초 1회만, 이후 로컬 서명 확인 |
| 불가일 등록 | 저장될 때까지 화면 정지 | 즉시 반영 후 저장 (실패 시 되돌림) |
| 동시 편집 | 문서 락으로 직렬화 | 자연키 UPSERT |
| 변경 추적 | 없음 | `audit_log` |
| 잠들기 | — | 없음 (요청이 없어도 다음 접속이 느려지지 않음) |

## 테스트

```bash
cd worker && npm test
```

## 로고

`assets/logo.svg` · `assets/logo-mark.svg` 는 기관 로고를 코드로 재현한 것입니다.
공식 원본 파일이 있으면 같은 폴더에 `logo.png` / `logo-mark.png` 로 넣기만 하면
자동으로 그쪽이 우선 표시됩니다(코드 수정 불필요).
