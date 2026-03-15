import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../observability/index.js';

const SQLITE_LOCAL_TIMESTAMP_EXPRESSION = `STRFTIME('%Y-%m-%dT%H:%M:%f', 'now', 'localtime')`;

export class Database {
  private db: SQLiteDatabase;
  private log = logger.child('Database');
  private initPromise: Promise<void>;

  constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new sqlite3.Database(dbPath);
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(`
          CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            uuid TEXT,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_memory (
            session_id INTEGER PRIMARY KEY,
            summary TEXT NOT NULL DEFAULT '',
            summarized_message_count INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_agent_state (
            session_id INTEGER PRIMARY KEY,
            agent_name TEXT NOT NULL,
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS memory_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            fact TEXT NOT NULL,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS conversation_memory (
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            summarized_until_message_id INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            PRIMARY KEY (channel, chat_id)
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS channel_resources (
            id TEXT PRIMARY KEY,
            channel TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            original_name TEXT NOT NULL,
            mime_type TEXT,
            size INTEGER,
            remote_url TEXT,
            platform_file_id TEXT,
            local_path TEXT,
            sha256 TEXT,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS channel_delivery_jobs (
            job_id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            channel TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            status TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            retryable INTEGER NOT NULL DEFAULT 0,
            next_retry_at DATETIME,
            platform_message_id TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
          )
        `);

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
        this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_unique ON memory_facts(channel, chat_id, fact)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_facts_chat ON memory_facts(channel, chat_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_channel_resources_message ON channel_resources(channel, conversation_id, message_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_channel_delivery_jobs_status ON channel_delivery_jobs(status, next_retry_at)`);

        this.db.all<{ name: string }>(`PRAGMA table_info(memory_facts)`, (err, columns) => {
          if (err) {
            reject(err);
            return;
          }

          const columnNames = new Set(columns.map((column) => column.name));
          const statements: string[] = [];

          if (!columnNames.has('created_at')) {
            statements.push(`ALTER TABLE memory_facts ADD COLUMN created_at DATETIME`);
          }
          if (!columnNames.has('last_seen_at')) {
            statements.push(`ALTER TABLE memory_facts ADD COLUMN last_seen_at DATETIME`);
          }
          if (!columnNames.has('confidence')) {
            statements.push(`ALTER TABLE memory_facts ADD COLUMN confidence REAL NOT NULL DEFAULT 1`);
          }
          if (!columnNames.has('confirmations')) {
            statements.push(`ALTER TABLE memory_facts ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 1`);
          }

          statements.push(
            `UPDATE memory_facts
             SET created_at = COALESCE(created_at, updated_at, ${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})`,
            `UPDATE memory_facts
             SET last_seen_at = COALESCE(last_seen_at, updated_at, created_at, ${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})`,
            `UPDATE memory_facts
             SET confidence = COALESCE(confidence, 1)`,
            `UPDATE memory_facts
             SET confirmations = COALESCE(confirmations, 1)`
          );

          const runNext = (index: number) => {
            if (index >= statements.length) {
              this.log.info('Tables initialized');
              resolve();
              return;
            }

            this.db.run(statements[index], (statementErr: Error | null) => {
              if (statementErr) {
                reject(statementErr);
                return;
              }

              runNext(index + 1);
            });
          };

          runNext(0);
        });
      });
    });
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err: Error | null) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err: Error | null, row: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(row as T | undefined);
        }
      });
    });
  }

  all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: Error | null, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close(() => {
        this.log.info('Database closed');
        resolve();
      });
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN IMMEDIATE', (err: Error | null) => {
          if (err) {
            if (err.message && err.message.includes('cannot start a transaction')) {
              this.log.debug('Already in transaction, executing without new transaction');
              Promise.resolve(fn()).then(resolve).catch(reject);
              return;
            }
            reject(err);
            return;
          }
          Promise.resolve(fn())
            .then((result) => {
              this.db.run('COMMIT', (commitErr: Error | null) => {
                if (commitErr) {
                  reject(commitErr);
                } else {
                  resolve(result);
                }
              });
            })
            .catch((err) => {
              this.db.run('ROLLBACK', () => {
                reject(err);
              });
            });
        });
      });
    });
  }
}

export interface DBSession {
  id: number;
  key: string;
  channel: string;
  chat_id: string;
  uuid: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  timestamp: string;
}

export interface DBSessionMemory {
  session_id: number;
  summary: string;
  summarized_message_count: number;
  updated_at: string;
}

export interface DBConversationMemory {
  channel: string;
  chat_id: string;
  summary: string;
  summarized_until_message_id: number;
  updated_at: string;
}

export interface DBSessionAgentState {
  session_id: number;
  agent_name: string;
  updated_at: string;
}

export interface DBMemoryFact {
  id: number;
  channel: string;
  chat_id: string;
  fact: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  confidence: number;
  confirmations: number;
}
