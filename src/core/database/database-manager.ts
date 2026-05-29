import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedLogger } from '@aesyclaw/core/logger';
import * as sessions from './repositories/session-repository';
import * as messages from './repositories/message-repository';

import * as cron from './repositories/cron-repository';
import * as usageRepo from './repositories/usage-repository';
import * as toolUsageRepo from './repositories/tool-usage-repository';
import type {
  SessionsRepository,
  MessagesRepository,
  CronJobsRepository,
  CronRunsRepository,
  UsageRepository,
  ToolUsageRepository,
} from './repository-types';
const logger = createScopedLogger('database-manager');

/**
 * SQLite 数据库管理器。
 *
 * 负责数据库连接生命周期、建表、迁移和仓库实例的组装。
 * 所有仓库 API 在 initialize() 后即可直接访问。
 */
export class DatabaseManager {
  private db: DatabaseSync | null = null;

  // 仓库 API 在 initialize() 时一次性构造,后续访问无 lambda 重建开销。
  sessions!: SessionsRepository;
  messages!: MessagesRepository;
  cronJobs!: CronJobsRepository;
  cronRuns!: CronRunsRepository;
  usage!: UsageRepository;
  toolUsage!: ToolUsageRepository;

  /**
   * 初始化数据库连接，确保父目录存在，运行迁移，并创建仓库实例。
   *
   * @param dbPath - SQLite 数据库文件路径
   */
  async initialize(dbPath: string): Promise<void> {
    if (this.db) {
      logger.warn('数据库已初始化 — 跳过');
      return;
    }
    mkdirSync(dirname(dbPath), { recursive: true });

    logger.info('打开数据库', { path: dbPath });
    const db = new DatabaseSync(dbPath);
    this.db = db;

    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');

    this.ensureTables();
    this.bindRepositories(db);

    logger.info('数据库初始化完成');
  }

  /** 销毁数据库管理器，优雅地关闭数据库连接 */
  async destroy(): Promise<void> {
    if (this.db) {
      logger.info('关闭数据库');
      this.db.close();
      this.db = null;
    }
  }

  /** 获取底层数据库实例 — 必须已初始化 */
  getDb(): DatabaseSync {
    if (!this.db) throw new Error('数据库尚未初始化');
    return this.db;
  }

  /** 获取数据库统计信息 */
  getStats(): { sessions: number; messages: number; cronJobs: number; usage: number } {
    const db = this.getDb();
    const sessionsCount =
      (db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number } | undefined)
        ?.count ?? 0;
    const messagesCount =
      (db.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number } | undefined)
        ?.count ?? 0;
    const cronJobsCount =
      (db.prepare('SELECT COUNT(*) as count FROM cron_jobs').get() as { count: number } | undefined)
        ?.count ?? 0;
    const usageCount =
      (db.prepare('SELECT COUNT(*) as count FROM usage').get() as { count: number } | undefined)
        ?.count ?? 0;
    return {
      sessions: sessionsCount,
      messages: messagesCount,
      cronJobs: cronJobsCount,
      usage: usageCount,
    };
  }

  // ─── 仓库绑定 ─────────────────────────────────────────────────

  private bindRepositories(db: DatabaseSync): void {
    this.sessions = {
      findOrCreate: (key) => sessions.findOrCreateSession(db, key),
      findByKey: (key) => sessions.findSessionByKey(db, key),
      findAll: () => sessions.findAllSessions(db),
      findAllSummaries: () => sessions.findAllSessionSummaries(db),
      findById: (id) => sessions.findSessionById(db, id),
      deleteByKey: (key) => sessions.deleteSessionByKey(db, key),
      setRole: (id, roleId) => sessions.setSessionRole(db, id, roleId),
      setModel: (id, modelId) => sessions.setSessionModel(db, id, modelId),
    };
    this.messages = {
      save: (sessionId, message) => messages.saveMessage(db, sessionId, message),
      loadHistory: (sessionId) => messages.loadMessageHistory(db, sessionId),
      clearHistory: (sessionId) => messages.clearMessageHistory(db, sessionId),
      replaceWithSummary: (sessionId, summary) =>
        messages.replaceMessageWithSummary(db, sessionId, summary),
    };

    this.cronJobs = {
      create: (params) => cron.createCronJob(db, params),
      findById: (id) => cron.findCronJobById(db, id),
      findAll: () => cron.findAllCronJobs(db),
      delete: (id) => cron.deleteCronJob(db, id),
      updateNextRun: (id, nextRun) => cron.updateCronJobNextRun(db, id, nextRun),
    };

    this.cronRuns = {
      create: (params) => cron.createCronRun(db, params),
      markCompleted: (runId, result) => cron.markCronRunCompleted(db, runId, result),
      markFailed: (runId, error) => cron.markCronRunFailed(db, runId, error),
      markAbandoned: (runIds) => cron.markCronRunsAbandoned(db, runIds),
      findRunning: () => cron.findRunningCronRuns(db),
      findByJobId: (jobId) => cron.findCronRunsByJobId(db, jobId),
    };

    this.usage = {
      create: (record) => usageRepo.createUsageRecord(db, record),
      getStats: (options) => usageRepo.getUsageStats(db, options),
      getTodaySummary: () => usageRepo.getTodayUsageSummary(db),
    };

    this.toolUsage = {
      create: (record) => toolUsageRepo.createToolUsageRecord(db, record),
      getStats: (options) => toolUsageRepo.getToolUsageStats(db, options),
    };
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
        role_id    TEXT,
        model_id   TEXT,
        UNIQUE(channel, type, chat_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        tool_data  TEXT,
        timestamp  DATETIME DEFAULT CURRENT_TIMESTAMP
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
        session_id   TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        message_id   INTEGER REFERENCES messages(id) ON DELETE SET NULL,
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

      CREATE TABLE IF NOT EXISTS tool_usage (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        name      TEXT NOT NULL,
        type      TEXT NOT NULL CHECK(type IN ('tool', 'skill')),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.ensureSessionColumns();
    this.ensureMessagesToolDataColumn();
    this.ensureUsageDetailColumns();
  }

  /**
   * 兼容旧数据库：为 sessions 表补充 role_id 和 model_id 列。
   *
   * 新库建表时已包含这两列，此处仅在旧库缺失时补充。
   * 注意：不处理 role_bindings 表的迁移（旧数据已不使用）。
   */
  private ensureSessionColumns(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    const columns = this.getTableColumns('sessions');
    if (!columns.has('role_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN role_id TEXT');
      logger.info('sessions 表已添加 role_id 列');
    }
    if (!columns.has('model_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN model_id TEXT');
      logger.info('sessions 表已添加 model_id 列');
    }
  }

  private ensureMessagesToolDataColumn(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    const columns = this.getTableColumns('messages');
    if (!columns.has('tool_data')) {
      this.db.exec('ALTER TABLE messages ADD COLUMN tool_data TEXT');
      logger.info('messages 表已添加 tool_data 列');
    }
  }

  private ensureUsageDetailColumns(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    const columns = this.getTableColumns('usage');

    if (!columns.has('session_id')) {
      this.db.exec(
        'ALTER TABLE usage ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL',
      );
    }
    if (!columns.has('message_id')) {
      this.db.exec(
        'ALTER TABLE usage ADD COLUMN message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL',
      );
    }
    if (!columns.has('cost_input')) {
      this.db.exec('ALTER TABLE usage ADD COLUMN cost_input REAL NOT NULL DEFAULT 0');
    }
    if (!columns.has('cost_output')) {
      this.db.exec('ALTER TABLE usage ADD COLUMN cost_output REAL NOT NULL DEFAULT 0');
    }
    if (!columns.has('cost_cache_read')) {
      this.db.exec('ALTER TABLE usage ADD COLUMN cost_cache_read REAL NOT NULL DEFAULT 0');
    }
    if (!columns.has('cost_cache_write')) {
      this.db.exec('ALTER TABLE usage ADD COLUMN cost_cache_write REAL NOT NULL DEFAULT 0');
    }
    if (!columns.has('cost_total')) {
      this.db.exec('ALTER TABLE usage ADD COLUMN cost_total REAL NOT NULL DEFAULT 0');
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_session_id ON usage(session_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_message_id ON usage(message_id) WHERE message_id IS NOT NULL;
    `);
  }

  private getTableColumns(table: 'messages' | 'usage' | 'sessions'): Set<string> {
    if (!this.db) throw new Error('数据库尚未初始化');
    const statement =
      table === 'messages'
        ? 'PRAGMA table_info(messages)'
        : table === 'sessions'
          ? 'PRAGMA table_info(sessions)'
          : 'PRAGMA table_info(usage)';
    const rows = this.db.prepare(statement).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }
}

export type {
  SessionsRepository,
  MessagesRepository,
  CronJobsRepository,
  CronRunsRepository,
  UsageRepository,
  ToolUsageRepository,
} from './repository-types';
