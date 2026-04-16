import Database from 'better-sqlite3';
import { pathResolver } from '../utils/paths.js';
import { logger } from '../observability/logger.js';

export class SQLiteManager {
  private static instance: SQLiteManager;
  private db: Database.Database | null = null;
  private initialized: boolean = false;

  private constructor() {}

  static getInstance(): SQLiteManager {
    if (!SQLiteManager.instance) {
      SQLiteManager.instance = new SQLiteManager();
    }
    return SQLiteManager.instance;
  }

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
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'default',
        role_id TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        command TEXT NOT NULL,
        prompt TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_run_at TEXT,
        next_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );
    `);

    logger.info({}, 'Database tables initialized');
  }

  private ensureIndexes(): void {
    this.getDatabase().exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_scope ON sessions(channel, type, chat_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
      CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_chat_id ON cron_jobs(chat_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
    `);
  }

  private getNativeBindingRepairHint(error: unknown): string | undefined {
    const message = error instanceof Error ? error.message : String(error);
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

  transaction<T>(fn: () => T): T {
    return this.getDatabase().transaction(fn)();
  }

  vacuum(): void {
    this.getDatabase().exec('VACUUM');
    logger.info({}, 'Database vacuumed');
  }
}

export const sqliteManager = SQLiteManager.getInstance();
