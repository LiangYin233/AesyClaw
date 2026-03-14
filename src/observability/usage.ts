import sqlite3, { Database as SQLiteDatabase } from 'sqlite3';
import { dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { logger } from './logging.js';

const RECENT_DAILY_USAGE_DAYS = 7;

export interface TokenUsageDailyStat {
  date: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated?: Date;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated: Date;
  daily: TokenUsageDailyStat[];
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

type PersistedDailyTokenUsage = {
  day_key: string;
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
  lastUpdated: new Date(),
  daily: []
};

function createEmptyDailyStat(date: string): TokenUsageDailyStat {
  return {
    date,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    requestCount: 0
  };
}

function formatDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRecentDailyStats(
  source: Map<string, TokenUsageDailyStat>,
  days: number = RECENT_DAILY_USAGE_DAYS,
  now: Date = new Date()
): TokenUsageDailyStat[] {
  const result: TokenUsageDailyStat[] = [];
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  for (let index = 0; index < days; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const dayKey = formatDayKey(current);
    const existing = source.get(dayKey);
    result.push(existing
      ? { ...existing }
      : createEmptyDailyStat(dayKey));
  }

  return result;
}

export class TokenUsageTracker {
  private log = logger.child('Usage');
  private config: UsageConfig = {
    enabled: true,
    persistFile: 'token-usage.db',
    flushIntervalMs: 30000
  };
  private stats: TokenUsage = { ...DEFAULT_STATS };
  private dailyStats = new Map<string, TokenUsageDailyStat>();
  private dirty = false;
  private dirtyDailyKeys = new Set<string>();
  private resetPending = false;
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

    const now = new Date();
    const dayKey = formatDayKey(now);
    const daily = this.dailyStats.get(dayKey) || createEmptyDailyStat(dayKey);

    this.stats.promptTokens += promptTokens;
    this.stats.completionTokens += completionTokens;
    this.stats.totalTokens += totalTokens;
    this.stats.requestCount += 1;
    this.stats.lastUpdated = now;
    daily.promptTokens += promptTokens;
    daily.completionTokens += completionTokens;
    daily.totalTokens += totalTokens;
    daily.requestCount += 1;
    daily.lastUpdated = now;
    this.dailyStats.set(dayKey, daily);
    this.dirty = true;
    this.dirtyDailyKeys.add(dayKey);
  }

  getStats(): TokenUsage {
    return {
      ...this.stats,
      daily: buildRecentDailyStats(this.dailyStats)
    };
  }

  getConfig(): UsageConfig {
    return { ...this.config };
  }

  reset(): void {
    this.stats = { ...DEFAULT_STATS, lastUpdated: new Date() };
    this.dailyStats.clear();
    this.dirty = true;
    this.dirtyDailyKeys.clear();
    this.resetPending = true;
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

    await this.run(`
      CREATE TABLE IF NOT EXISTS token_usage_daily (
        day_key TEXT PRIMARY KEY,
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
      this.stats = { ...DEFAULT_STATS, lastUpdated: new Date(), daily: [] };
    } else {
      this.stats = {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        requestCount: row.request_count,
        lastUpdated: new Date(row.last_updated),
        daily: []
      };
    }

    const dailyRows = await this.all<PersistedDailyTokenUsage>(
      `SELECT day_key, prompt_tokens, completion_tokens, total_tokens, request_count, last_updated
       FROM token_usage_daily`
    );
    this.dailyStats = new Map(
      dailyRows.map((dailyRow) => [
        dailyRow.day_key,
        {
          date: dailyRow.day_key,
          promptTokens: dailyRow.prompt_tokens,
          completionTokens: dailyRow.completion_tokens,
          totalTokens: dailyRow.total_tokens,
          requestCount: dailyRow.request_count,
          lastUpdated: new Date(dailyRow.last_updated)
        }
      ])
    );
    this.log.info('Token usage loaded', {
      persistFile: this.config.persistFile,
      totalTokens: this.stats.totalTokens,
      requestCount: this.stats.requestCount,
      dailyBuckets: this.dailyStats.size
    });
  }

  private async flushIfDirty(): Promise<void> {
    if (!this.config.enabled || !this.dirty) {
      return;
    }

    try {
      await this.ensureDatabase();
      await this.run('BEGIN TRANSACTION');

      if (this.resetPending) {
        await this.run('DELETE FROM token_usage_daily');
        await this.run('DELETE FROM token_usage_stats');
      }

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

      for (const dayKey of this.dirtyDailyKeys) {
        const daily = this.dailyStats.get(dayKey);
        if (!daily) {
          continue;
        }

        await this.run(
          `INSERT INTO token_usage_daily (
             day_key, prompt_tokens, completion_tokens, total_tokens, request_count, last_updated
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(day_key) DO UPDATE SET
             prompt_tokens = excluded.prompt_tokens,
             completion_tokens = excluded.completion_tokens,
             total_tokens = excluded.total_tokens,
             request_count = excluded.request_count,
             last_updated = excluded.last_updated`,
          [
            daily.date,
            daily.promptTokens,
            daily.completionTokens,
            daily.totalTokens,
            daily.requestCount,
            daily.lastUpdated?.toISOString() || new Date().toISOString()
          ]
        );
      }

      await this.run('COMMIT');
      this.dirty = false;
      this.dirtyDailyKeys.clear();
      this.resetPending = false;
    } catch (error) {
      try {
        await this.run('ROLLBACK');
      } catch {
        // Ignore rollback errors and preserve dirty state for retry.
      }
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

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) {
      throw new Error('Token usage database is not initialized');
    }

    return await new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }
        resolve((rows as T[]) || []);
      });
    });
  }
}

export const tokenUsage = new TokenUsageTracker();
