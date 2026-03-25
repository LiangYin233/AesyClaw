import sqlite3 from 'sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { logger } from '../observability/index.js';
import { runSqlMigrations } from '../db/MigrationRunner.js';
import { cronMigrations } from '../db/migrations.js';
import type { CronJob } from './CronService.js';

type SQLiteParam = string | number | boolean | null | Buffer | Date | undefined;
type SQLiteParams = SQLiteParam[];

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
        this.log.error(`打开数据库失败: ${err.message}`);
      } else {
        this.log.info(`数据库已打开: ${dbPath}`);
      }
    });
  }

  /**
   * 初始化数据库表
   */
  async initialize(): Promise<void> {
    await runSqlMigrations({
      scope: 'cron',
      log: this.log,
      migrations: cronMigrations,
      execute: async (sql, params = []) => {
        await this.run(sql, params);
      },
      queryAppliedVersions: async () => {
        const rows = await this.getRows(
          'SELECT version FROM schema_migrations WHERE scope = ? ORDER BY version',
          ['cron']
        ).catch(() => []);
        return rows
          .map((row) => row.version)
          .filter((version): version is string => typeof version === 'string');
      },
      transaction: async <T>(operation: () => Promise<T>) => this.transaction(operation)
    });
    this.ready = true;
    this.log.info('数据库初始化完成');
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
    await this.transaction(async () => {
      for (const job of jobs) {
        await this.run(
          'UPDATE cron_jobs SET next_run_at_ms = ?, last_run_at_ms = ?, updated_at = ? WHERE id = ?',
          [job.nextRunAtMs ?? null, job.lastRunAtMs ?? null, Date.now(), job.id]
        );
      }
    });
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
  private run(sql: string, params: SQLiteParams = []): Promise<{ changes: number; lastID: number }> {
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
  private getRow(sql: string, params: SQLiteParams = []): Promise<Record<string, unknown> | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as Record<string, unknown> | undefined);
      });
    });
  }

  /**
   * 获取多行数据
   */
  private getRows(sql: string, params: SQLiteParams = []): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve((rows || []) as Record<string, unknown>[]);
      });
    });
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.run('BEGIN TRANSACTION');
    try {
      const result = await operation();
      await this.run('COMMIT');
      return result;
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * 关闭数据库连接
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          this.log.error(`关闭数据库失败: ${err.message}`);
          reject(err);
        } else {
          this.log.info('数据库已关闭');
          resolve();
        }
      });
    });
  }
}
