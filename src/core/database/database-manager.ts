import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedLogger } from '@aesyclaw/core/logger';
import * as sessions from './repositories/session-repository';
import * as messages from './repositories/message-repository';
import * as roleBindings from './repositories/role-binding-repository';
import * as cron from './repositories/cron-repository';
import * as usageRepo from './repositories/usage-repository';
import * as toolUsageRepo from './repositories/tool-usage-repository';
import type { MessageUsage } from '@aesyclaw/core/types';

const logger = createScopedLogger('database-manager');

/**
 * 仓库 API 类型 — 由 DatabaseManager 在 initialize() 时一次性构造,
 * 供其它子系统直接消费。通过方法签名声明接口，避免各子系统
 * 重复声明相同子集类型。
 */

/** 会话仓库 API 类型 */
export type SessionsRepository = {
  findOrCreate: (
    key: Parameters<typeof sessions.findOrCreateSession>[1],
  ) => ReturnType<typeof sessions.findOrCreateSession>;
  findByKey: (
    key: Parameters<typeof sessions.findSessionByKey>[1],
  ) => ReturnType<typeof sessions.findSessionByKey>;
  findAll: () => ReturnType<typeof sessions.findAllSessions>;
  findAllSummaries: () => ReturnType<typeof sessions.findAllSessionSummaries>;
  findById: (id: string) => ReturnType<typeof sessions.findSessionById>;
};

/** 消息仓库 API 类型 */
export type MessagesRepository = {
  save: (
    sessionId: string,
    message: Parameters<typeof messages.saveMessage>[2],
  ) => ReturnType<typeof messages.saveMessage>;
  loadHistory: (sessionId: string) => ReturnType<typeof messages.loadMessageHistory>;
  clearHistory: (sessionId: string) => ReturnType<typeof messages.clearMessageHistory>;
  replaceWithSummary: (
    sessionId: string,
    summary: string,
  ) => ReturnType<typeof messages.replaceMessageWithSummary>;
};

/** 角色绑定仓库 API 类型 */
export type RoleBindingsRepository = {
  getActiveRole: (sessionId: string) => ReturnType<typeof roleBindings.getActiveRoleBinding>;
  setActiveRole: (
    sessionId: string,
    roleId: string,
  ) => ReturnType<typeof roleBindings.setActiveRoleBinding>;
};

/** 定时任务仓库 API 类型 */
export type CronJobsRepository = {
  create: (
    params: Parameters<typeof cron.createCronJob>[1],
  ) => ReturnType<typeof cron.createCronJob>;
  findById: (id: string) => ReturnType<typeof cron.findCronJobById>;
  findAll: () => ReturnType<typeof cron.findAllCronJobs>;
  delete: (id: string) => ReturnType<typeof cron.deleteCronJob>;
  updateNextRun: (id: string, nextRun: Date | null) => ReturnType<typeof cron.updateCronJobNextRun>;
};

/** 定时任务执行仓库 API 类型 */
export type CronRunsRepository = {
  create: (params: { jobId: string }) => ReturnType<typeof cron.createCronRun>;
  markCompleted: (runId: string, result: string) => ReturnType<typeof cron.markCronRunCompleted>;
  markFailed: (runId: string, error: string) => ReturnType<typeof cron.markCronRunFailed>;
  markAbandoned: (runIds: string[]) => ReturnType<typeof cron.markCronRunsAbandoned>;
  findRunning: () => ReturnType<typeof cron.findRunningCronRuns>;
  findByJobId: (jobId: string) => ReturnType<typeof cron.findCronRunsByJobId>;
};

/** 用量统计仓库 API 类型 */
export type UsageRepository = {
  create: (
    record: Parameters<typeof usageRepo.createUsageRecord>[1],
  ) => ReturnType<typeof usageRepo.createUsageRecord>;
  getStats: (
    options?: Parameters<typeof usageRepo.getUsageStats>[1],
  ) => ReturnType<typeof usageRepo.getUsageStats>;
  getTodaySummary: () => ReturnType<typeof usageRepo.getTodayUsageSummary>;
};

/** 工具使用统计仓库 API 类型 */
export type ToolUsageRepository = {
  create: (
    record: Parameters<typeof toolUsageRepo.createToolUsageRecord>[1],
  ) => ReturnType<typeof toolUsageRepo.createToolUsageRecord>;
  getStats: (
    options?: Parameters<typeof toolUsageRepo.getToolUsageStats>[1],
  ) => ReturnType<typeof toolUsageRepo.getToolUsageStats>;
};

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
  roleBindings!: RoleBindingsRepository;
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
    };

    this.messages = {
      save: (sessionId, message) => messages.saveMessage(db, sessionId, message),
      loadHistory: (sessionId) => messages.loadMessageHistory(db, sessionId),
      clearHistory: (sessionId) => messages.clearMessageHistory(db, sessionId),
      replaceWithSummary: (sessionId, summary) =>
        messages.replaceMessageWithSummary(db, sessionId, summary),
    };

    this.roleBindings = {
      getActiveRole: (sessionId) => roleBindings.getActiveRoleBinding(db, sessionId),
      setActiveRole: (sessionId, roleId) =>
        roleBindings.setActiveRoleBinding(db, sessionId, roleId),
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

    this.ensureUsageDetailColumns();
    this.migrateLegacyMessageUsageJson();
    this.dropLegacyMessageUsageColumn();
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

  private migrateLegacyMessageUsageJson(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    if (!this.getTableColumns('messages').has('usage_json')) return;

    const rows = this.db
      .prepare(
        `SELECT id, session_id, timestamp, usage_json
         FROM messages
         WHERE role = 'assistant' AND usage_json IS NOT NULL AND TRIM(usage_json) <> ''`,
      )
      .all() as Array<{ id: number; session_id: string; timestamp: string; usage_json: string }>;

    const existingLinked = this.db.prepare('SELECT id FROM usage WHERE message_id = ? LIMIT 1');
    const findUnlinked = this.db.prepare(
      `SELECT id FROM usage
       WHERE message_id IS NULL
         AND input_tokens = ?
         AND output_tokens = ?
         AND total_tokens = ?
         AND cache_read_tokens = ?
         AND cache_write_tokens = ?
       ORDER BY ABS(strftime('%s', timestamp) - strftime('%s', ?)) ASC, id DESC
       LIMIT 1`,
    );
    const linkUsage = this.db.prepare(
      `UPDATE usage
       SET session_id = ?,
           message_id = ?,
           cost_input = ?,
           cost_output = ?,
           cost_cache_read = ?,
           cost_cache_write = ?,
           cost_total = ?
       WHERE id = ?`,
    );
    const insertUsage = this.db.prepare(
      `INSERT INTO usage (
        model, provider, api, response_id, session_id, message_id, timestamp,
        input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const row of rows) {
      if (existingLinked.get(row.id)) continue;
      const usage = parseMessageUsage(row.usage_json);
      if (!usage) continue;

      const matchingUsage = findUnlinked.get(
        usage.input,
        usage.output,
        usage.totalTokens,
        usage.cacheRead,
        usage.cacheWrite,
        row.timestamp,
      ) as { id: number } | undefined;

      if (matchingUsage) {
        linkUsage.run(
          row.session_id,
          row.id,
          usage.cost?.input ?? 0,
          usage.cost?.output ?? 0,
          usage.cost?.cacheRead ?? 0,
          usage.cost?.cacheWrite ?? 0,
          usage.cost?.total ?? 0,
          matchingUsage.id,
        );
        continue;
      }

      insertUsage.run(
        'persisted-history',
        'persisted-history',
        'persisted-history',
        null,
        row.session_id,
        row.id,
        row.timestamp,
        usage.input,
        usage.output,
        usage.totalTokens,
        usage.cacheRead,
        usage.cacheWrite,
        usage.cost?.input ?? 0,
        usage.cost?.output ?? 0,
        usage.cost?.cacheRead ?? 0,
        usage.cost?.cacheWrite ?? 0,
        usage.cost?.total ?? 0,
      );
    }
  }

  private dropLegacyMessageUsageColumn(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    if (!this.getTableColumns('messages').has('usage_json')) return;

    try {
      this.db.exec('ALTER TABLE messages DROP COLUMN usage_json');
    } catch (err) {
      logger.warn('无法移除旧消息用量列，后续读取将忽略该列', err);
    }
  }

  private getTableColumns(table: 'messages' | 'usage'): Set<string> {
    if (!this.db) throw new Error('数据库尚未初始化');
    const statement =
      table === 'messages' ? 'PRAGMA table_info(messages)' : 'PRAGMA table_info(usage)';
    const rows = this.db.prepare(statement).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }
}

function parseMessageUsage(value: string): MessageUsage | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isMessageUsage(parsed)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function isMessageUsage(value: unknown): value is MessageUsage {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['totalTokens']) &&
    (value['cost'] === undefined || isUsageCost(value['cost']))
  );
}

function isUsageCost(value: unknown): value is NonNullable<MessageUsage['cost']> {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value['input']) &&
    isFiniteNumber(value['output']) &&
    isFiniteNumber(value['cacheRead']) &&
    isFiniteNumber(value['cacheWrite']) &&
    isFiniteNumber(value['total'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
