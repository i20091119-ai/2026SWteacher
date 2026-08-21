# 데이터베이스 구조

Cloudflare D1 (SQLite). 정의 원본은 [`worker/schema.sql`](../worker/schema.sql) 입니다.

설계에서 시트와 달라진 점:

- 월 단위 조회가 **인덱스를 타는 범위 스캔**입니다 (`date >= '2026-06-01' AND date < '2026-07-01'`).
  시트 시절에는 탭 전체를 읽어 자바스크립트로 걸렀습니다.
- 모든 쓰기가 자연키 기준 UPSERT 입니다. "전체를 읽어 행 번호를 찾아 그 줄에 쓰기" 가 사라졌습니다.
- `설정` 탭에 문자열 키로 섞여 있던 값(`holiday.*`, `publish.*`, `admin.whitelist`)을 각자 표로 분리했습니다.

## `instructors` — 강사 명단

| 열 | 설명 |
|---|---|
| `name` (PK) | 이름 |
| `sort_order` | 등록 순서 |
| `active` | 1 = 현재 명단. 0 = 명단에서 내려간 사람 / 순번에 넣지 않는 파견교사 |

명단에서 내려도 행을 지우지 않습니다(`active = 0`). 지난 배치와 장부 기록이 그대로 남습니다.
`active = 0` 인 사람도 배치 대상으로는 고를 수 있습니다.

## `admins` — 관리자 화이트리스트

| 열 | 설명 |
|---|---|
| `email` (PK) | Google 계정 |

여기 없는 계정은 Google 로그인에 성공해도 관리자로 들어오지 못합니다.
이미 발급된 세션도 요청마다 이 표와 대조하므로, 행을 지우면 즉시 차단됩니다.

## `settings` — 단가 / 상한

| 키 | 기본값 |
|---|---|
| `rate.explain` | 30000 |
| `rate.other` | 20000 |
| `weeklyCap` | 14 |

API 로 바꿀 수 있는 키는 이 셋뿐입니다(값도 숫자만 받습니다).

## `holidays` — 휴관일 / 공휴일

| 열 | 설명 |
|---|---|
| `date` (PK) | `YYYY-MM-DD` |
| `label` | 표시용 이름 |

2026년 한국 공휴일이 `seed.sql` 에 들어 있습니다. 운영상 휴관이 아닌 날은 지우면 됩니다.

## `months` — 월 상태

| 열 | 설명 |
|---|---|
| `ym` (PK) | `YYYY-MM` |
| `published` | 1 이면 강사 화면에 확정 근무표가 보인다 |
| `published_at` | 공개 시각 |

## `unavailable` — 근무불가일

| 열 | 설명 |
|---|---|
| `name`, `date` (PK) | |
| `reason` | 사유 메모 |

강사는 자기 이름으로만 쓸 수 있습니다(요청의 `name` 은 무시하고 세션의 이름을 씁니다).

## `submissions` — 제출 현황

| 열 | 설명 |
|---|---|
| `ym`, `name` (PK) | |
| `submitted`, `submitted_at` | |

불가일을 고치면 그 달 제출 상태가 자동으로 풀립니다.

## `assignments` — 일정(배치)

| 열 | 설명 |
|---|---|
| `id` (PK) | UUID |
| `date` | `YYYY-MM-DD` — 인덱스 |
| `kind` | `해설` / `연구` / `지원` (읽기 전용 과거값: `연구이월` / `지원이월`) |
| `form` | `학교체험` / `가족체험` / `주말어드벤처` / 공란 |
| `role` | `주` / `보조` / `토오전` / `토오후` / `일오전` / 공란 |
| `name` | 강사 |
| `h_explain`, `h_support`, `h_research` | 시수 (0.5 단위) |
| `memo` | |

인덱스: `(date)`, `(name, date)`, `(form, role, date)`

`연구이월` / `지원이월` 은 이월 기능이 폐지되면서 **새로 만들 수 없습니다.**
시트에서 넘어온 과거 행은 값이 그대로 보존되고, 장부에서도 그대로 집계됩니다.

## `audit_log` — 변경 이력

| 열 | 설명 |
|---|---|
| `at`, `actor`, `role`, `action`, `detail` | |

누가 언제 무엇을 바꿨는지 남습니다. 시트로는 불가능했던 부분입니다.

```bash
cd worker
npx wrangler d1 execute swteacher-db --remote \
  --command "SELECT at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT 30"
```
