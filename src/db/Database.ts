import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';  // SQLite3 数据库驱动
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';

export class Database {
  private db: SQLiteDatabase;  // SQLite 数据库实例
  private log = logger.child({ prefix: 'Database' });  // 子日志记录器
  private initPromise: Promise<void>;  // 初始化 Promise

  constructor(dbPath: string) {  // 构造函数
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {  // 确保目录存在
      mkdirSync(dir, { recursive: true });
    }

    this.db = new sqlite3.Database(dbPath);  // 创建数据库连接
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {  // 初始化数据库表结构
    return new Promise((resolve) => {
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
        `);  // 创建会话表

        this.db.run(`
          CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);  // 创建消息表

        this.db.run(`
          CREATE TABLE IF NOT EXISTS session_memory (
            session_id INTEGER PRIMARY KEY,
            summary TEXT NOT NULL DEFAULT '',
            summarized_message_count INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS memory_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            fact TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key)`);  // 会话键索引
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);  // 消息会话索引
        this.db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_unique ON memory_facts(channel, chat_id, fact)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_memory_facts_chat ON memory_facts(channel, chat_id)`);

        this.log.info('Tables initialized');
        resolve();
      });
    });
  }

  async ready(): Promise<void> {  // 等待数据库就绪
    await this.initPromise;
  }

  run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {  // 执行 INSERT/UPDATE/DELETE
    const endTimer = metrics.timer('db.query_time', { operation: 'run' });
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err: Error | null) {
        endTimer();
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });  // 返回最后插入ID和影响行数
        }
      });
    });
  }

  get<T>(sql: string, params: any[] = []): Promise<T | undefined> {  // 查询单条记录
    const endTimer = metrics.timer('db.query_time', { operation: 'get' });
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err: Error | null, row: any) => {
        endTimer();
        if (err) {
          reject(err);
        } else {
          resolve(row as T | undefined);
        }
      });
    });
  }

  all<T>(sql: string, params: any[] = []): Promise<T[]> {  // 查询多条记录
    const endTimer = metrics.timer('db.query_time', { operation: 'all' });
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err: Error | null, rows: any[]) => {
        endTimer();
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  close(): Promise<void> {  // 关闭数据库连接
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
            // If we get "cannot start a transaction within a transaction" error,
            // just execute the function without a new transaction
            if (err.message && err.message.includes('cannot start a transaction')) {
              this.log.debug('Already in transaction, executing without new transaction');
              Promise.resolve(fn())
                .then(resolve)
                .catch(reject);
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

export interface DBSession {  // 会话数据库记录
  id: number;
  key: string;
  channel: string;
  chat_id: string;
  uuid: string | null;
  created_at: string;
  updated_at: string;
}

export interface DBMessage {  // 消息数据库记录
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

export interface DBMemoryFact {
  id: number;
  channel: string;
  chat_id: string;
  fact: string;
  updated_at: string;
}
