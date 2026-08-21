-- 이미 만들어 둔 D1 에 교체요청 / 학생프로그램 / carry 를 추가하는 이관 스크립트.
-- 새로 만드는 DB 는 schema.sql 만 돌리면 되므로 이 파일이 필요 없다.
--
--   wrangler d1 execute swteacher-db --remote --file=./migrations/2026-08-21-swaps-programs.sql
--
-- 데이터를 지우지 않는다. 다만 ALTER TABLE 은 두 번 실행하면
-- "duplicate column name: carry" 로 실패한다 — 그 오류가 나면 이미 적용된 것이니 무시하면 된다.

ALTER TABLE assignments ADD COLUMN carry INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS swaps (
  id            TEXT PRIMARY KEY,
  ym            TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  requester     TEXT NOT NULL,
  target        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending_admin',
  requested_at  TEXT NOT NULL DEFAULT '',
  responded_at  TEXT NOT NULL DEFAULT '',
  finalized_at  TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_swaps_ym         ON swaps(ym);
CREATE INDEX IF NOT EXISTS idx_swaps_assignment ON swaps(assignment_id, status);

CREATE TABLE IF NOT EXISTS programs (
  id         TEXT PRIMARY KEY,
  date_start TEXT NOT NULL,
  date_end   TEXT NOT NULL,
  session    TEXT NOT NULL DEFAULT '',
  school     TEXT NOT NULL,
  students   INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_programs_start ON programs(date_start);
CREATE INDEX IF NOT EXISTS idx_programs_end   ON programs(date_end);

-- 강사 6명 체제 + 파견교사, 주간 상한 20h
INSERT OR IGNORE INTO instructors (name, sort_order, active) VALUES
  ('현수진', 6, 1), ('이상우', 99, 0);
UPDATE settings SET value = '20' WHERE key = 'weeklyCap' AND value = '14';
