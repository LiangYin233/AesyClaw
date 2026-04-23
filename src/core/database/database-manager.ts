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

import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createScopedLogger } from '../logger';
import { SessionRepository } from './repositories/session-repository';
import { MessageRepository } from './repositories/message-repository';
import { RoleBindingRepository } from './repositories/role-binding-repository';
import { CronJobRepository, CronRunRepository } from './repositories/cron-repository';
import * as migration001 from './migrations/001_initial';

const logger = createScopedLogger('db');

/** Migration definition */
interface Migration {
  id: number;
  up: (db: BetterSqlite3.Database) => void;
}

const migrations: Migration[] = [
  { id: 1, up: migration001.up },
];

export class DatabaseManager {
  private db: BetterSqlite3.Database | null = null;
  private _sessions: SessionRepository | null = null;
  private _messages: MessageRepository | null = null;
  private _roleBindings: RoleBindingRepository | null = null;
  private _cronJobs: CronJobRepository | null = null;
  private _cronRuns: CronRunRepository | null = null;

  /**
   * Initialise the database connection, ensure the parent directory
   * exists, run migrations, and create repository instances.
   */
  async initialize(dbPath: string): Promise<void> {
    // Ensure the data directory exists
    mkdirSync(dirname(dbPath), { recursive: true });

    logger.info('Opening database', { path: dbPath });
    this.db = new BetterSqlite3(dbPath);

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL');
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    this.runMigrations();

    // Create repository instances
    this._sessions = new SessionRepository(this.db);
    this._messages = new MessageRepository(this.db);
    this._roleBindings = new RoleBindingRepository(this.db);
    this._cronJobs = new CronJobRepository(this.db);
    this._cronRuns = new CronRunRepository(this.db);

    logger.info('Database initialised');
  }

  /** Close the database connection gracefully */
  async close(): Promise<void> {
    if (this.db) {
      logger.info('Closing database');
      this.db.close();
      this.db = null;
      this._sessions = null;
      this._messages = null;
      this._roleBindings = null;
      this._cronJobs = null;
      this._cronRuns = null;
    }
  }

  // ─── Repository accessors ──────────────────────────────────────

  get sessions(): SessionRepository {
    if (!this._sessions) throw new Error('Database not initialised');
    return this._sessions;
  }

  get messages(): MessageRepository {
    if (!this._messages) throw new Error('Database not initialised');
    return this._messages;
  }

  get roleBindings(): RoleBindingRepository {
    if (!this._roleBindings) throw new Error('Database not initialised');
    return this._roleBindings;
  }

  get cronJobs(): CronJobRepository {
    if (!this._cronJobs) throw new Error('Database not initialised');
    return this._cronJobs;
  }

  get cronRuns(): CronRunRepository {
    if (!this._cronRuns) throw new Error('Database not initialised');
    return this._cronRuns;
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
      const applied = this.db
        .prepare('SELECT id FROM _migrations WHERE id = ?')
        .get(migration.id);

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