/** @file SQLite 数据库管理器
 *
 * SQLiteManager 负责初始化 SQLite 数据库连接，创建表结构与索引，
 * 并提供事务支持。使用 better-sqlite3 作为底层驱动。
 *
 * 数据库文件位于 .aesyclaw/data/aesyclaw.db。
 * 启用 WAL 模式以提高并发性能，启用外键约束。
 */

import Database from 'better-sqlite3';
import { pathResolver } from '../utils/paths.js';
import { logger } from '../observability/logger.js';
import { toErrorMessage } from '../utils/errors.js';

/** SQLite 数据库管理器 */
class SQLiteManager {
  private db: Database.Database | null = null;
  private initialized: boolean = false;

  /** 初始化数据库连接并创建表结构 */
  initialize(): void {
    if (this.initialized) {
      return;
    }

    try {
      const dbPath = pathResolver.getDataFilePath();
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      this.initializeTables();
      this.ensureIndexes();

      this.initialized = true;
      logger.info({ dbPath }, 'SQLiteManager initialized');
    } catch (error) {
      const hint = this.getNativeBindingRepairHint(error);
      logger.error(hint ? { error, hint } : { error }, 'Failed to initialize SQLiteManager');
      throw error;
    }
  }

  /** 创建数据库表 */
  private initializeTables(): void {
    this.getDatabase().exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        role_id TEXT NOT NULL DEFAULT 'default',
        PRIMARY KEY (channel, type, chat_id)
      );

      CREATE TABLE IF NOT EXISTS chat_messages (
        channel TEXT NOT NULL,
        type TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        PRIMARY KEY (channel, type, chat_id, sequence)
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        prompt TEXT NOT NULL,
        schedule_type TEXT NOT NULL,
        schedule_data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        CHECK(length(trim(prompt)) > 0)
      );

      CREATE TABLE IF NOT EXISTS cron_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error TEXT,
        FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
      );
    `);

    logger.info({}, 'Database tables initialized');
  }

  /** 创建数据库索引 */
  private ensureIndexes(): void {
    this.getDatabase().exec(`
      DROP INDEX IF EXISTS idx_cron_jobs_next_run;
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at)
        WHERE schedule_type IS NOT NULL AND next_run_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_cron_runs_job_id_started_at ON cron_runs(job_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status);
    `);
  }

  /** 获取 better-sqlite3 原生绑定修复提示 */
  private getNativeBindingRepairHint(error: unknown): string | undefined {
    const message = toErrorMessage(error);
    if (!message.includes('Could not locate the bindings file')) {
      return undefined;
    }

    return 'better-sqlite3 native bindings are missing; run `npm rebuild better-sqlite3` or reinstall dependencies.';
  }

  /** 获取数据库实例（未初始化时抛出错误） */
  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /** 关闭数据库连接 */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info({}, 'SQLiteManager closed');
    }
  }

  /** 执行事务 */
  transaction<T>(fn: () => T): T {
    return this.getDatabase().transaction(fn)();
  }
}

export const sqliteManager = new SQLiteManager();
