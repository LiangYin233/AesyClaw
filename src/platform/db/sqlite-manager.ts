import Database from 'better-sqlite3';
import { pathResolver } from '../utils/paths.js';
import { logger } from '../observability/logger.js';
import { toErrorMessage } from '../utils/errors.js';

class SQLiteManager {
  private db: Database.Database | null = null;
  private initialized: boolean = false;

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
        chat_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        prompt TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
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

  private ensureIndexes(): void {
    this.getDatabase().exec(`
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_chat_id ON cron_jobs(chat_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
      CREATE INDEX IF NOT EXISTS idx_cron_runs_job_id ON cron_runs(job_id, started_at DESC);
    `);
  }

  private getNativeBindingRepairHint(error: unknown): string | undefined {
    const message = toErrorMessage(error);
    if (!message.includes('Could not locate the bindings file')) {
      return undefined;
    }

    return 'better-sqlite3 native bindings are missing; run `npm rebuild better-sqlite3` or reinstall dependencies.';
  }

  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info({}, 'SQLiteManager closed');
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  transaction<T>(fn: () => T): T {
    return this.getDatabase().transaction(fn)();
  }
}

export const sqliteManager = new SQLiteManager();
