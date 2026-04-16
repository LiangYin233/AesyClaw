import { sqliteManager } from '../sqlite-manager.js';

export abstract class BaseRepository<TRow, TRecord> {
  protected get db() {
    return sqliteManager.getDatabase();
  }

  protected abstract mapRow(row: TRow): TRecord;

  protected queryOne(sql: string, ...params: unknown[]): TRecord | null {
    const row = this.db.prepare(sql).get(...params) as TRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  protected queryMany(sql: string, ...params: unknown[]): TRecord[] {
    const rows = this.db.prepare(sql).all(...params) as TRow[];
    return rows.map(row => this.mapRow(row));
  }
}
