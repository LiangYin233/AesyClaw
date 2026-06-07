import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { SessionRepository } from './repositories/session-repository';
import { CronJobRepository, CronRunRepository } from './repositories/cron-repository';
import * as usageRepo from './repositories/usage-repository';
import * as toolUsageRepo from './repositories/tool-usage-repository';
import type {
  SessionsRepository,
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
    const messagesCount = 0; // messages stored in JSON files
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
    const sessionRepo = new SessionRepository(db);
    this.sessions = {
      findOrCreate: (key) => sessionRepo.findOrCreate(key),
      findByKey: (key) => sessionRepo.findByKey(key),
      findAll: () => sessionRepo.findAll('id'),
      findById: (id) => sessionRepo.findById(id),
      deleteById: (id) => sessionRepo.deleteWithRelations(id),
      setRole: (id, roleId) => sessionRepo.setRole(id, roleId),
      setModel: (id, modelId) => sessionRepo.setModel(id, modelId),
    };

    const cronJobsRepo = new CronJobRepository(db);
    this.cronJobs = {
      create: (params) => cronJobsRepo.createJob(params),
      findById: (id) => cronJobsRepo.findById(id),
      findAll: () => cronJobsRepo.findAll('next_run ASC'),
      delete: (id) => cronJobsRepo.deleteWithRuns(id),
      updateNextRun: (id, nextRun) => cronJobsRepo.updateNextRun(id, nextRun),
      update: (id, patch) => cronJobsRepo.updateJob(id, patch),
      setEnabled: (id, enabled) => cronJobsRepo.setEnabled(id, enabled),
    };

    const cronRunsRepo = new CronRunRepository(db);
    this.cronRuns = {
      create: (params) => cronRunsRepo.createRun(params),
      markCompleted: (runId, result) => cronRunsRepo.markCompleted(runId, result),
      markFailed: (runId, error) => cronRunsRepo.markFailed(runId, error),
      markAbandoned: (runIds) => cronRunsRepo.markAbandoned(runIds),
      findRunning: () => cronRunsRepo.findRunning(),
      findByJobId: (jobId) => cronRunsRepo.findByJobId(jobId),
    };

    this.usage = {
      create: (record) => usageRepo.createUsageRecord(db, record),
      getStats: (options) => usageRepo.getUsageStats(db, options),
      getTodaySummary: () => usageRepo.getTodayUsageSummary(db),
      getLatestContextUsage: (sessionId) => usageRepo.getLatestContextUsage(db, sessionId),
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


      CREATE TABLE IF NOT EXISTS cron_jobs (
        id             TEXT PRIMARY KEY,
        schedule_type  TEXT NOT NULL,
        schedule_value TEXT NOT NULL,
        prompt         TEXT NOT NULL,
        session_key    TEXT NOT NULL,
        next_run       DATETIME,
        enabled        INTEGER NOT NULL DEFAULT 1,
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
    this.ensureCronJobColumns();

    this.ensureUsageColumns();
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

  private ensureCronJobColumns(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    const columns = this.getTableColumns('cron_jobs');
    if (!columns.has('enabled')) {
      this.db.exec('ALTER TABLE cron_jobs ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1');
      logger.info('cron_jobs 表已添加 enabled 列');
    }
  }

  private ensureUsageColumns(): void {
    if (!this.db) throw new Error('数据库尚未初始化');
    const columns = this.getTableColumns('usage');
    const requiredColumns = [
      'id',
      'model',
      'provider',
      'api',
      'response_id',
      'session_id',
      'timestamp',
      'input_tokens',
      'output_tokens',
      'total_tokens',
      'cache_read_tokens',
      'cache_write_tokens',
      'cost_input',
      'cost_output',
      'cost_cache_read',
      'cost_cache_write',
      'cost_total',
    ];
    const missing = requiredColumns.filter((column) => !columns.has(column));
    if (missing.length > 0) {
      throw new Error(
        `usage 表结构不完整，缺少列：${missing.join(', ')}。请手动迁移或清理旧数据库。`,
      );
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_session_id ON usage(session_id);
    `);
  }

  private getTableColumns(table: 'usage' | 'sessions' | 'cron_jobs'): Set<string> {
    if (!this.db) throw new Error('数据库尚未初始化');
    const statement = `PRAGMA table_info(${table})`;
    const rows = this.db.prepare(statement).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }
}

export type {
  SessionsRepository,
  CronJobsRepository,
  CronRunsRepository,
  UsageRepository,
  ToolUsageRepository,
} from './repository-types';
