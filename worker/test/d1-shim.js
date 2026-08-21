/**
 * 테스트용 D1 셰임 — node:sqlite 위에 Cloudflare D1 의 API 모양을 씌운다.
 * (prepare/bind/first/all/run/batch)
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Stmt(this.db, this.sql, args.map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v)));
  }
  _prep() {
    return this.db.prepare(this.sql);
  }
  async first(col) {
    const rows = this._prep().all(...this.args);
    if (!rows.length) return null;
    const row = { ...rows[0] };
    return col === undefined ? row : row[col];
  }
  async all() {
    const rows = this._prep().all(...this.args).map((r) => ({ ...r }));
    return { success: true, results: rows, meta: { changes: 0 } };
  }
  async run() {
    const info = this._prep().run(...this.args);
    return {
      success: true,
      results: [],
      meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) },
    };
  }
}

export class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }
  loadFile(path) {
    this.db.exec(readFileSync(path, "utf8"));
    return this;
  }
  prepare(sql) {
    return new Stmt(this.db, sql);
  }
  async batch(stmts) {
    // D1 의 batch 는 암묵적 트랜잭션으로 실행된다.
    this.db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) {
        out.push(/^\s*SELECT/i.test(s.sql) ? await s.all() : await s.run());
      }
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
