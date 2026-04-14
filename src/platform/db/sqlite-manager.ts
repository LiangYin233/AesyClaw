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
      this.runMigrations();

      this.initialized = true;
      logger.info({ dbPath }, 'SQLiteManager initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize SQLiteManager');
      throw error;
    }
  }

  private initializeTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'unknown',
        type TEXT NOT NULL DEFAULT 'default',
        user_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT DEFAULT '{}'
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

      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_chat_id ON sessions(chat_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_scope ON sessions(channel, type, chat_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_chat_id ON cron_jobs(chat_id);
      CREATE INDEX IF NOT EXISTS idx_cron_jobs_next_run ON cron_jobs(next_run_at) WHERE enabled = 1;
    `);

    logger.info({}, 'Database tables initialized');
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const result = this.db.prepare("PRAGMA table_info(cron_jobs)").all() as Array<{name: string}>;
      const columns = new Set(result.map(r => r.name));

      if (!columns.has('prompt')) {
        this.db.exec('ALTER TABLE cron_jobs ADD COLUMN prompt TEXT');
        logger.info({}, 'Migration: Added prompt column to cron_jobs');
      }
    } catch (error) {
      logger.warn({ error }, 'Migration check failed (table may not exist yet)');
    }
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
    if (!this.db) throw new Error('Database not initialized');
    return this.db.transaction(fn)();
  }

  vacuum(): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.exec('VACUUM');
    logger.info({}, 'Database vacuumed');
  }
}

export const sqliteManager = SQLiteManager.getInstance();
