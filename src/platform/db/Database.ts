import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../observability/index.js';
import { runSqlMigrations } from './MigrationRunner.js';
import { databaseMigrations } from './migrations.js';

type SQLiteParam = string | number | boolean | null | Buffer | Date | undefined;
type SQLiteParams = SQLiteParam[];

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
    await runSqlMigrations({
      scope: 'main',
      log: this.log,
      migrations: databaseMigrations,
      execute: async (sql, params = []) => {
        await this.run(sql, params);
      },
      queryAppliedVersions: async () => {
        const rows = await this.all<{ version: string }>(
          'SELECT version FROM schema_migrations WHERE scope = ? ORDER BY version',
          ['main']
        ).catch(() => []);
        return rows.map((row) => row.version);
      },
      transaction: async <T>(operation: () => Promise<T>) => this.transaction(operation)
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
