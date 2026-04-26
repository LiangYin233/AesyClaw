/**
 * DatabaseManager — manages the SQLite connection lifecycle,
 * provides repository accessors, and runs migrations on initialise.
 *
 * Usage:
 *   const db = new DatabaseManager();
 *   await db.initialize(pathResolver.dbFile);
 *   // ... use db.sessions, db.messages, etc.
 *   await db.close();
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createScopedLogger } from '../logger';
import * as sessions from './repositories/session-repository';
import * as messages from './repositories/message-repository';
import * as roleBindings from './repositories/role-binding-repository';
import * as cron from './repositories/cron-repository';

const logger = createScopedLogger('db');

/** Migration definition */
interface Migration {
  id: number;
  up: (db: DatabaseSync) => void;
}

const migrations: Migration[] = [{ id: 1, up: applyInitialMigration }];

export class DatabaseManager {
  private db: DatabaseSync | null = null;

  /**
   * Initialise the database connection, ensure the parent directory
   * exists, run migrations, and create repository instances.
   */
  async initialize(dbPath: string): Promise<void> {
    // Ensure the data directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    logger.info('Opening database', { path: dbPath });
    this.db = new DatabaseSync(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.exec('PRAGMA journal_mode = WAL');
    // Enable foreign keys
    this.db.exec('PRAGMA foreign_keys = ON');

    this.runMigrations();

    logger.info('Database initialised');
  }

  /** Close the database connection gracefully */
  async close(): Promise<void> {
    if (this.db) {
      logger.info('Closing database');
      this.db.close();
      this.db = null;
    }
  }

  /** Get the underlying database instance — must be initialised */
  getDb(): DatabaseSync {
    if (!this.db) throw new Error('Database not initialised');
    return this.db;
  }

  // ─── Repository accessors ──────────────────────────────────────

  /** Session repository functions bound to the current db */
  get sessions() {
    const db = this.getDb();
    return {
      findOrCreate: (key: Parameters<typeof sessions.findOrCreateSession>[1]) =>
        sessions.findOrCreateSession(db, key),
      findByKey: (key: Parameters<typeof sessions.findSessionByKey>[1]) =>
        sessions.findSessionByKey(db, key),
    };
  }

  /** Message repository functions bound to the current db */
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

  /** Role binding repository functions bound to the current db */
  get roleBindings() {
    const db = this.getDb();
    return {
      getActiveRole: (sessionId: string) => roleBindings.getActiveRoleBinding(db, sessionId),
      setActiveRole: (sessionId: string, roleId: string) =>
        roleBindings.setActiveRoleBinding(db, sessionId, roleId),
    };
  }

  /** Cron job repository functions bound to the current db */
  get cronJobs() {
    const db = this.getDb();
    return {
      create: (params: Parameters<typeof cron.createCronJob>[1]) =>
        cron.createCronJob(db, params),
      findById: (id: string) => cron.findCronJobById(db, id),
      findAll: () => cron.findAllCronJobs(db),
      delete: (id: string) => cron.deleteCronJob(db, id),
      updateNextRun: (id: string, nextRun: Date | null) =>
        cron.updateCronJobNextRun(db, id, nextRun),
    };
  }

  /** Cron run repository functions bound to the current db */
  get cronRuns() {
    const db = this.getDb();
    return {
      create: (params: { jobId: string }) => cron.createCronRun(db, params),
      markCompleted: (runId: string, result: string) =>
        cron.markCronRunCompleted(db, runId, result),
      markFailed: (runId: string, error: string) =>
        cron.markCronRunFailed(db, runId, error),
      markAbandoned: (runIds: string[]) => cron.markCronRunsAbandoned(db, runIds),
      findRunning: () => cron.findRunningCronRuns(db),
    };
  }

  // ─── Migrations ────────────────────────────────────────────────

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialised');

    // Create migrations tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id   INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      );
    `);

    for (const migration of migrations) {
      const applied = this.db.prepare('SELECT id FROM _migrations WHERE id = ?').get(migration.id);

      if (!applied) {
        logger.info(`Running migration ${migration.id}`);
        migration.up(this.db);
        this.db
          .prepare('INSERT INTO _migrations (id, name) VALUES (?, ?)')
          .run(migration.id, `migration_${String(migration.id).padStart(3, '0')}`);
        logger.info(`Migration ${migration.id} applied`);
      }
    }
  }
}

function applyInitialMigration(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      channel    TEXT NOT NULL,
      type       TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  `);
}
