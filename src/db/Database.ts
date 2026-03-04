import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../logger/index.js';

export class Database {
  private db: SQLiteDatabase;
  private log = logger.child({ prefix: 'Database' });
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);

        this.log.info('Tables initialized');
        resolve();
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
