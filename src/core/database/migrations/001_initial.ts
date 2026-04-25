/**
 * Initial database migration — creates all tables.
 *
 * Uses IF NOT EXISTS for idempotency so this file can be re-run
 * safely (e.g. during development).
 */

import type { DatabaseSync } from 'node:sqlite';

export function up(db: DatabaseSync): void {
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
      id            TEXT PRIMARY KEY,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      prompt        TEXT NOT NULL,
      session_key   TEXT NOT NULL,
      next_run      DATETIME,
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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

export function down(db: DatabaseSync): void {
  db.exec(`
    DROP TABLE IF EXISTS cron_runs;
    DROP TABLE IF EXISTS cron_jobs;
    DROP TABLE IF EXISTS role_bindings;
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS sessions;
  `);
}
