import sqlite3 from 'sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../observability/index.js';
import type { CronJob } from './CronService.js';

/**
 * Cron 任务数据库存储
 */
export class CronStore {
  private db: sqlite3.Database;
  private log = logger.child('CronStore');
  private ready = false;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        this.log.error(`Failed to open database: ${err.message}`);
      } else {
        this.log.info(`Database opened: ${dbPath}`);
      }
    });
  }

  /**
   * 初始化数据库表
   */
  async initialize(): Promise<void> {
    await this.run(`
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        schedule_kind TEXT NOT NULL,
        schedule_data TEXT NOT NULL,
        payload TEXT NOT NULL,
        next_run_at_ms INTEGER,
        last_run_at_ms INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await this.run(`
      CREATE INDEX IF NOT EXISTS idx_next_run
      ON cron_jobs(enabled, next_run_at_ms)
      WHERE enabled = 1 AND next_run_at_ms IS NOT NULL
    `);

    this.ready = true;
    this.log.info('Database initialized');
  }

  /**
   * 添加或更新任务
   */
  async upsert(job: CronJob): Promise<void> {
    const now = Date.now();

    await this.run(
      `INSERT INTO cron_jobs (
        id, name, enabled, schedule_kind, schedule_data, payload,
        next_run_at_ms, last_run_at_ms, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        enabled = excluded.enabled,
        schedule_kind = excluded.schedule_kind,
        schedule_data = excluded.schedule_data,
        payload = excluded.payload,
        next_run_at_ms = excluded.next_run_at_ms,
        last_run_at_ms = excluded.last_run_at_ms,
        updated_at = excluded.updated_at`,
      [
        job.id,
        job.name,
        job.enabled ? 1 : 0,
        job.schedule.kind,
        JSON.stringify(job.schedule),
        JSON.stringify(job.payload),
        job.nextRunAtMs ?? null,
        job.lastRunAtMs ?? null,
        now,
        now
      ]
    );
  }

  /**
   * 删除任务
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.run('DELETE FROM cron_jobs WHERE id = ?', [id]);
    return result.changes > 0;
  }

  /**
   * 获取单个任务
   */
  async get(id: string): Promise<CronJob | null> {
    const row = await this.getRow('SELECT * FROM cron_jobs WHERE id = ?', [id]);
    return row ? this.rowToJob(row) : null;
  }

  /**
   * 获取所有任务
   */
  async getAll(): Promise<CronJob[]> {
    const rows = await this.getRows('SELECT * FROM cron_jobs ORDER BY created_at DESC');
    return rows.map(row => this.rowToJob(row));
  }

  /**
   * 更新任务状态
   */
  async updateStatus(id: string, enabled: boolean, nextRunAtMs?: number): Promise<void> {
    await this.run(
      'UPDATE cron_jobs SET enabled = ?, next_run_at_ms = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, nextRunAtMs ?? null, Date.now(), id]
    );
  }

  /**
   * 更新任务执行时间
   */
  async updateRunTimes(id: string, lastRunAtMs: number, nextRunAtMs?: number): Promise<void> {
    await this.run(
      'UPDATE cron_jobs SET last_run_at_ms = ?, next_run_at_ms = ?, updated_at = ? WHERE id = ?',
      [lastRunAtMs, nextRunAtMs ?? null, Date.now(), id]
    );
  }

  /**
   * 批量更新任务
   */
  async batchUpdate(jobs: CronJob[]): Promise<void> {
    await this.run('BEGIN TRANSACTION');
    try {
      for (const job of jobs) {
        await this.run(
          'UPDATE cron_jobs SET next_run_at_ms = ?, last_run_at_ms = ?, updated_at = ? WHERE id = ?',
          [job.nextRunAtMs ?? null, job.lastRunAtMs ?? null, Date.now(), job.id]
        );
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 将数据库行转换为 CronJob 对象
   */
  private rowToJob(row: any): CronJob {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      schedule: JSON.parse(row.schedule_data),
      payload: JSON.parse(row.payload),
      nextRunAtMs: row.next_run_at_ms,
      lastRunAtMs: row.last_run_at_ms
    };
  }

  /**
   * 执行 SQL 语句（无返回值）
   */
  private run(sql: string, params: any[] = []): Promise<{ changes: number; lastID: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
  }

  /**
   * 获取单行数据
   */
  private getRow(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  /**
   * 获取多行数据
   */
  private getRows(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          this.log.error(`Failed to close database: ${err.message}`);
          reject(err);
        } else {
          this.log.info('Database closed');
          resolve();
        }
      });
    });
  }
}

