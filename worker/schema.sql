-- 경남수학문화관 SW해설강사 일정 관리 — D1(SQLite) 스키마
-- 적용: wrangler d1 execute swteacher-db --remote --file=./schema.sql
--
-- 설계 원칙
--  * 조회 경로(월 단위)에 반드시 인덱스가 걸리도록 date/ym 컬럼을 기준으로 잡는다.
--  * 스프레드시트의 "행 번호 찾기" 패턴을 없애고 자연키 PRIMARY KEY + UPSERT로 대체한다.
--  * 공휴일/공개여부처럼 설정 탭에 문자열 키로 쑤셔넣던 값은 각자 테이블로 분리한다.

PRAGMA foreign_keys = ON;

-- 강사 명단. 가나다순 정렬은 순번 계산의 기준이므로 서버에서 확정해 내려준다.
CREATE TABLE IF NOT EXISTS instructors (
  name        TEXT PRIMARY KEY,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 관리자 화이트리스트. 기존 settings 의 admin.whitelist 쉼표 문자열을 대체한다.
CREATE TABLE IF NOT EXISTS admins (
  email     TEXT PRIMARY KEY,
  note      TEXT NOT NULL DEFAULT '',
  added_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 단가/주간상한 등 스칼라 설정만 남긴다. (holiday.* / publish.* 는 별도 테이블로 이관)
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- 휴관일/공휴일.
CREATE TABLE IF NOT EXISTS holidays (
  date   TEXT PRIMARY KEY,           -- YYYY-MM-DD
  label  TEXT NOT NULL DEFAULT ''
);

-- 월 단위 상태(확정 공개 여부).
CREATE TABLE IF NOT EXISTS months (
  ym           TEXT PRIMARY KEY,     -- YYYY-MM
  published    INTEGER NOT NULL DEFAULT 0,
  published_at TEXT
);

-- 근무불가일. (name, date) 자연키 → 토글이 단일 UPSERT/DELETE 로 끝난다.
CREATE TABLE IF NOT EXISTS unavailable (
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,          -- YYYY-MM-DD
  reason     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (name, date)
);
CREATE INDEX IF NOT EXISTS idx_unavailable_date ON unavailable(date);

-- 근무불가일 제출 현황.
CREATE TABLE IF NOT EXISTS submissions (
  ym           TEXT NOT NULL,        -- YYYY-MM
  name         TEXT NOT NULL,
  submitted    INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (ym, name)
);

-- 일정(배치).
CREATE TABLE IF NOT EXISTS assignments (
  id         TEXT PRIMARY KEY,       -- UUID
  date       TEXT NOT NULL,          -- YYYY-MM-DD
  kind       TEXT NOT NULL,          -- 해설 / 연구 / 지원 / 연구이월 / 지원이월
  form       TEXT NOT NULL DEFAULT '', -- 학교체험 / 가족체험 / 주말어드벤처
  role       TEXT NOT NULL DEFAULT '', -- 주 / 보조 / 토오전 / 토오후 / 일오전
  name       TEXT NOT NULL,
  h_explain  REAL NOT NULL DEFAULT 0,
  h_support  REAL NOT NULL DEFAULT 0,
  h_research REAL NOT NULL DEFAULT 0,
  memo       TEXT NOT NULL DEFAULT '',
  carry      INTEGER NOT NULL DEFAULT 0,   -- 관리자가 손으로 다는 '이월 표시' 플래그(표시 전용)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_assignments_date      ON assignments(date);
CREATE INDEX IF NOT EXISTS idx_assignments_name_date ON assignments(name, date);
CREATE INDEX IF NOT EXISTS idx_assignments_form_role ON assignments(form, role, date);

-- 수업 교체 요청. 강사가 신청하고 관리자가 승인하면 배치의 담당 강사가 바뀐다.
CREATE TABLE IF NOT EXISTS swaps (
  id            TEXT PRIMARY KEY,
  ym            TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  requester     TEXT NOT NULL,
  target        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending_admin',  -- pending_admin / completed / rejected / cancelled
  requested_at  TEXT NOT NULL DEFAULT '',
  responded_at  TEXT NOT NULL DEFAULT '',
  finalized_at  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_swaps_ym         ON swaps(ym);
-- 같은 배치에 진행 중인 요청이 있는지 한 번에 확인하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_swaps_assignment ON swaps(assignment_id, status);

-- 학생 체험 프로그램 일정. 캘린더에 함께 표시되며 강사·관리자 모두 본다.
CREATE TABLE IF NOT EXISTS programs (
  id         TEXT PRIMARY KEY,
  date_start TEXT NOT NULL,
  date_end   TEXT NOT NULL,
  session    TEXT NOT NULL DEFAULT '',   -- 오전 / 오후 / 공란
  school     TEXT NOT NULL,
  students   INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);
-- 기간이 걸치는 달을 찾기 위해 시작일·종료일 양쪽에 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_programs_start ON programs(date_start);
CREATE INDEX IF NOT EXISTS idx_programs_end   ON programs(date_end);

-- 변경 이력. 시트에서는 불가능했던 "누가 언제 무엇을 바꿨나" 추적.
CREATE TABLE IF NOT EXISTS audit_log (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  actor  TEXT NOT NULL DEFAULT '',
  role   TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
