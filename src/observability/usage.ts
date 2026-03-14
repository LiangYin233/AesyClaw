import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from './logging.js';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated: Date;
}

export interface UsageConfig {
  enabled: boolean;
  persistFile: string;
  flushIntervalMs: number;
}

type PersistedTokenUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_count: number;
  last_updated: string;
};

const DEFAULT_STATS: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  lastUpdated: new Date()
};

export class TokenUsageTracker {
  private log = logger.child('Usage');
  private config: UsageConfig = {
    enabled: true,
    persistFile: 'token-usage.db',
    flushIntervalMs: 30000
  };
  private stats: TokenUsage = { ...DEFAULT_STATS };
  private dirty = false;
  private saveInterval: NodeJS.Timeout;
  private db?: SQLiteDatabase;
  private dbPath?: string;
  private ready: Promise<void> = Promise.resolve();

  constructor() {
    this.saveInterval = setInterval(() => {
      void this.flushIfDirty();
    }, this.config.flushIntervalMs);
  }

  configure(partial: Partial<UsageConfig>): void {
    const previousFile = this.config.persistFile;
    const previousInterval = this.config.flushIntervalMs;
    this.config = {
      ...this.config,
      ...partial
    };

    if (previousInterval !== this.config.flushIntervalMs) {
      clearInterval(this.saveInterval);
      this.saveInterval = setInterval(() => {
        void this.flushIfDirty();
      }, this.config.flushIntervalMs);
    }

    if (!this.config.enabled) {
      this.ready = this.ready
        .then(async () => {
          await this.flushIfDirty();
          await this.closeDatabase();
        })
        .catch((error) => {
          this.log.warn('Failed to disable token usage database', {
            persistFile: this.config.persistFile,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return;
    }

    if (previousFile !== this.config.persistFile) {
      this.ready = this.ready
        .then(async () => {
          await this.flushIfDirty();
          await this.closeDatabase();
          await this.openDatabase(this.config.persistFile);
          await this.loadFromDatabase();
        })
        .catch((error) => {
          this.log.warn('Failed to reconfigure token usage database', {
            persistFile: this.config.persistFile,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      return;
    }

    this.ready = this.ready
      .then(async () => {
        await this.ensureDatabase();
        await this.loadFromDatabase();
      })
      .catch((error) => {
        this.log.warn('Failed to initialize token usage database', {
          persistFile: this.config.persistFile,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }

  record(promptTokens: number, completionTokens: number, totalTokens: number): void {
    if (!this.config.enabled) {
      return;
    }

    this.stats.promptTokens += promptTokens;
    this.stats.completionTokens += completionTokens;
    this.stats.totalTokens += totalTokens;
    this.stats.requestCount += 1;
    this.stats.lastUpdated = new Date();
    this.dirty = true;
  }

  getStats(): TokenUsage {
    return { ...this.stats };
  }

  getConfig(): UsageConfig {
    return { ...this.config };
  }

  reset(): void {
    this.stats = { ...DEFAULT_STATS, lastUpdated: new Date() };
    this.dirty = true;
    void this.flushIfDirty().then(() => {
      this.log.info('Token usage reset');
    });
  }

  async destroy(): Promise<void> {
    clearInterval(this.saveInterval);
    await this.flushIfDirty();
    await this.closeDatabase();
  }

  private async ensureDatabase(): Promise<void> {
    if (this.db && this.dbPath === this.config.persistFile) {
      return;
    }

    await this.openDatabase(this.config.persistFile);
  }

  private async openDatabase(filePath: string): Promise<void> {
    if (this.db && this.dbPath === filePath) {
      return;
    }

    await this.closeDatabase();
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.dbPath = filePath;
    this.db = await new Promise<SQLiteDatabase>((resolve, reject) => {
      const db = new sqlite3.Database(filePath, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(db);
      });
    });

    await this.run(`
      CREATE TABLE IF NOT EXISTS token_usage_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        request_count INTEGER NOT NULL DEFAULT 0,
        last_updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  private async loadFromDatabase(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    await this.ensureDatabase();
    const row = await this.get<PersistedTokenUsage>(
      `SELECT prompt_tokens, completion_tokens, total_tokens, request_count, last_updated
       FROM token_usage_stats
       WHERE id = 1`
    );

    if (!row) {
      this.stats = { ...DEFAULT_STATS, lastUpdated: new Date() };
      return;
    }

    this.stats = {
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      requestCount: row.request_count,
      lastUpdated: new Date(row.last_updated)
    };
    this.log.info('Token usage loaded', {
      persistFile: this.config.persistFile,
      totalTokens: this.stats.totalTokens,
      requestCount: this.stats.requestCount
    });
  }

  private async flushIfDirty(): Promise<void> {
    if (!this.config.enabled || !this.dirty) {
      return;
    }

    try {
      await this.ensureDatabase();
      await this.run(
        `INSERT INTO token_usage_stats (
           id, prompt_tokens, completion_tokens, total_tokens, request_count, last_updated
         ) VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           prompt_tokens = excluded.prompt_tokens,
           completion_tokens = excluded.completion_tokens,
           total_tokens = excluded.total_tokens,
           request_count = excluded.request_count,
           last_updated = excluded.last_updated`,
        [
          this.stats.promptTokens,
          this.stats.completionTokens,
          this.stats.totalTokens,
          this.stats.requestCount,
          this.stats.lastUpdated.toISOString()
        ]
      );
      this.dirty = false;
    } catch (error) {
      this.log.error('Failed to save token usage', {
        persistFile: this.config.persistFile,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async closeDatabase(): Promise<void> {
    if (!this.db) {
      return;
    }

    const db = this.db;
    this.db = undefined;
    this.dbPath = undefined;

    await new Promise<void>((resolve) => {
      db.close(() => resolve());
    });
  }

  private async run(sql: string, params: unknown[] = []): Promise<void> {
    if (!this.db) {
      throw new Error('Token usage database is not initialized');
    }

    await new Promise<void>((resolve, reject) => {
      this.db!.run(sql, params, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    if (!this.db) {
      throw new Error('Token usage database is not initialized');
    }

    return await new Promise<T | undefined>((resolve, reject) => {
      this.db!.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(row as T | undefined);
      });
    });
  }
}

export const tokenUsage = new TokenUsageTracker();
