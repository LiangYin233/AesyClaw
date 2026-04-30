import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedLogger } from '../logger';
import * as sessions from './repositories/session-repository';
import * as messages from './repositories/message-repository';
import * as roleBindings from './repositories/role-binding-repository';
import * as cron from './repositories/cron-repository';
import * as usageRepo from './repositories/usage-repository';

const logger = createScopedLogger('db');

export class DatabaseManager {
  private db: DatabaseSync | null = null;

  /**
   * 初始化数据库连接，确保父目录存在，运行迁移，并创建仓库实例。
   */
  async initialize(dbPath: string): Promise<void> {
    // 确保数据目录存在
    mkdirSync(dirname(dbPath), { recursive: true });

    logger.info('打开数据库', { path: dbPath });
    this.db = new DatabaseSync(dbPath);

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.ensureTables();

    logger.info('数据库初始化完成');
  }

  /** 优雅地关闭数据库连接 */
  async close(): Promise<void> {
    if (this.db) {
      logger.info('关闭数据库');
      this.db.close();
      this.db = null;
    }
  }

  /** 获取底层数据库实例 —— 必须已初始化 */
  getDb(): DatabaseSync {
    if (!this.db) throw new Error('数据库尚未初始化');
    return this.db;
  }

  // ─── 仓库访问器 ──────────────────────────────────────

  /** 绑定到当前数据库的会话仓库函数 */
  get sessions() {
    const db = this.getDb();
    return {
      findOrCreate: (key: Parameters<typeof sessions.findOrCreateSession>[1]) =>
        sessions.findOrCreateSession(db, key),
      findByKey: (key: Parameters<typeof sessions.findSessionByKey>[1]) =>
        sessions.findSessionByKey(db, key),
      findAll: () => sessions.findAllSessions(db),
      findById: (id: string) => sessions.findSessionById(db, id),
    };
  }

  /** 绑定到当前数据库的消息仓库函数 */
  get messages() {
    const db = this.getDb();
    return {
      save: (sessionId: string, message: Parameters<typeof messages.saveMessage>[2]) =>
        messages.saveMessage(db, sessionId, message),
      loadHistory: (sessionId: string) => messages.loadMessageHistory(db, sessionId),
      clearHistory: (sessionId: string) => messages.clearMessageHistory(db, sessionId),
      replaceWithSummary: (sessionId: string, summary: string) =>
        messages.replaceMessageWithSummary(db, sessionId, summary),
    };
  }

  /** 绑定到当前数据库的角色绑定仓库函数 */
  get roleBindings() {
    const db = this.getDb();
    return {
      getActiveRole: (sessionId: string) => roleBindings.getActiveRoleBinding(db, sessionId),
      setActiveRole: (sessionId: string, roleId: string) =>
        roleBindings.setActiveRoleBinding(db, sessionId, roleId),
    };
  }

  /** 绑定到当前数据库的定时任务仓库函数 */
  get cronJobs() {
    const db = this.getDb();
    return {
      create: (params: Parameters<typeof cron.createCronJob>[1]) => cron.createCronJob(db, params),
      findById: (id: string) => cron.findCronJobById(db, id),
      findAll: () => cron.findAllCronJobs(db),
      delete: (id: string) => cron.deleteCronJob(db, id),
      updateNextRun: (id: string, nextRun: Date | null) =>
        cron.updateCronJobNextRun(db, id, nextRun),
    };
  }

  /** 绑定到当前数据库的定时任务运行仓库函数 */
  get cronRuns() {
    const db = this.getDb();
    return {
      create: (params: { jobId: string }) => cron.createCronRun(db, params),
      markCompleted: (runId: string, result: string) =>
        cron.markCronRunCompleted(db, runId, result),
      markFailed: (runId: string, error: string) => cron.markCronRunFailed(db, runId, error),
      markAbandoned: (runIds: string[]) => cron.markCronRunsAbandoned(db, runIds),
      findRunning: () => cron.findRunningCronRuns(db),
      findByJobId: (jobId: string) => cron.findCronRunsByJobId(db, jobId),
    };
  }

  /** 绑定到当前数据库的用量仓库函数 */
  get usage() {
    const db = this.getDb();
    return {
      create: (record: Parameters<typeof usageRepo.createUsageRecord>[1]) =>
        usageRepo.createUsageRecord(db, record),
      getStats: (options?: Parameters<typeof usageRepo.getUsageStats>[1]) =>
        usageRepo.getUsageStats(db, options),
      getTodaySummary: () => usageRepo.getTodayUsageSummary(db),
    };
  }

  /** 获取数据库统计信息 */
  getStats(): { sessions: number; messages: number; cronJobs: number; usage: number } {
    const db = this.getDb();
    const sessions =
      (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number } | undefined)
        ?.count ?? 0;
    const messages =
      (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number } | undefined)
        ?.count ?? 0;
    const cronJobs =
      (db.prepare('SELECT COUNT(*) as count FROM cron_jobs').get() as { count: number } | undefined)
        ?.count ?? 0;
    const usage =
      (db.prepare('SELECT COUNT(*) as count FROM usage').get() as { count: number } | undefined)
        ?.count ?? 0;
    return { sessions, messages, cronJobs, usage };
  }

  // ─── 建表 ──────────────────────────────────────────────────

  private ensureTables(): void {
    if (!this.db) throw new Error('数据库尚未初始化');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        channel    TEXT NOT NULL,
        type       TEXT NOT NULL,
        chat_id    TEXT NOT NULL,
        UNIQUE(channel, type, chat_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS role_bindings (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id),
        role_id    TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id             TEXT PRIMARY KEY,
        schedule_type  TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        prompt         TEXT NOT NULL,
        session_key    TEXT NOT NULL,
        next_run       DATETIME,
        created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cron_runs (
        id         TEXT PRIMARY KEY,
        job_id     TEXT NOT NULL REFERENCES cron_jobs(id),
        status     TEXT NOT NULL,
        result     TEXT,
        error      TEXT,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at   DATETIME
      );

      CREATE TABLE IF NOT EXISTS usage (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        model        TEXT NOT NULL,
        provider     TEXT NOT NULL,
        api          TEXT NOT NULL,
        response_id  TEXT,
        timestamp    DATETIME DEFAULT CURRENT_TIMESTAMP,
        input_tokens        INTEGER NOT NULL,
        output_tokens       INTEGER NOT NULL,
        total_tokens        INTEGER NOT NULL,
        cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
        cost_input          REAL NOT NULL DEFAULT 0,
        cost_output         REAL NOT NULL DEFAULT 0,
        cost_cache_read     REAL NOT NULL DEFAULT 0,
        cost_cache_write    REAL NOT NULL DEFAULT 0,
        cost_total          REAL NOT NULL DEFAULT 0
      );
    `);
  }
}
