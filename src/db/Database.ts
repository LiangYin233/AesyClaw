import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../observability/index.js';

type SQLiteParam = string | number | boolean | null | Buffer | Date | undefined;
type SQLiteParams = SQLiteParam[];

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
    return new Promise((resolve) => {
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
          CREATE TABLE IF NOT EXISTS memory_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'other',
            content TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            confidence REAL NOT NULL DEFAULT 1,
            confirmations INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            last_seen_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION})
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS memory_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            entry_id INTEGER,
            action TEXT NOT NULL,
            actor TEXT NOT NULL,
            reason TEXT,
            before_json TEXT,
            after_json TEXT,
            evidence_json TEXT,
            created_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE SET NULL
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS memory_embeddings (
            entry_id INTEGER NOT NULL,
            provider_name TEXT NOT NULL,
            model TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            embedding_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT (${SQLITE_LOCAL_TIMESTAMP_EXPRESSION}),
            PRIMARY KEY (entry_id, provider_name, model),
            FOREIGN KEY (entry_id) REFERENCES memory_entries(id) ON DELETE CASCADE
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
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_entries_chat ON memory_entries(channel, chat_id, status)`);
        this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_entries_unique_active ON memory_entries(channel, chat_id, content) WHERE status = 'active'`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_operations_chat ON memory_operations(channel, chat_id, created_at)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_embeddings_lookup ON memory_embeddings(provider_name, model, updated_at)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_channel_resources_message ON channel_resources(channel, conversation_id, message_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_channel_delivery_jobs_status ON channel_delivery_jobs(status, next_retry_at)`);
        this.log.info('数据表初始化完成');
        resolve();
      });
    });
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  run(sql: string, params: SQLiteParams = []): Promise<{ lastID: number; changes: number }> {
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

  get<T>(sql: string, params: SQLiteParams = []): Promise<T | undefined> {
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

  all<T>(sql: string, params: SQLiteParams = []): Promise<T[]> {
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
        this.log.info('数据库已关闭');
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
              this.log.debug('已在事务中，无需新建事务');
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

export interface DBMemoryEntry {
  id: number;
  channel: string;
  chat_id: string;
  kind: string;
  content: string;
  status: string;
  confidence: number;
  confirmations: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface DBMemoryOperation {
  id: number;
  channel: string;
  chat_id: string;
  entry_id: number | null;
  action: string;
  actor: string;
  reason: string | null;
  before_json: string | null;
  after_json: string | null;
  evidence_json: string | null;
  created_at: string;
}

export interface DBMemoryEmbedding {
  entry_id: number;
  provider_name: string;
  model: string;
  content_hash: string;
  dimensions: number;
  embedding_json: string;
  updated_at: string;
}
