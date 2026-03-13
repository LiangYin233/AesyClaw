import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from './index.js';

/**
 * Token 使用统计
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
  lastUpdated: Date;
}

/**
 * Token 统计持久化管理器
 */
export class TokenStatsManager {
  private stats: TokenUsage;
  private statsFile: string;
  private log = logger.child({ prefix: 'TokenStats' });
  private saveInterval: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(dataDir?: string) {
    this.statsFile = dataDir ? join(dataDir, 'token-stats.json') : 'token-stats.json';
    this.stats = this.load();

    // 每 30 秒自动保存一次（如果有变更）
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.save();
        this.dirty = false;
      }
    }, 30000);
  }

  /**
   * 设置数据目录
   */
  setDataDir(dataDir: string): void {
    const oldFile = this.statsFile;
    this.statsFile = join(dataDir, 'token-stats.json');

    // 如果有未保存的数据，先保存到旧位置
    if (this.dirty) {
      try {
        writeFileSync(oldFile, JSON.stringify(this.stats, null, 2), 'utf-8');
      } catch (error) {
        this.log.warn(`Failed to save to old location: ${error}`);
      }
    }

    // 重新加载（如果新位置有数据）
    const newStats = this.load();
    if (newStats.requestCount > 0) {
      this.stats = newStats;
      this.log.info(`Loaded existing stats from ${this.statsFile}`);
    } else {
      // 新位置没有数据，保存当前数据
      this.save();
    }
  }

  /**
   * 加载统计数据
   */
  private load(): TokenUsage {
    try {
      if (existsSync(this.statsFile)) {
        const data = JSON.parse(readFileSync(this.statsFile, 'utf-8'));
        this.log.info(`Loaded token stats: ${data.totalTokens} total tokens, ${data.requestCount} requests`);
        return {
          ...data,
          lastUpdated: new Date(data.lastUpdated)
        };
      }
    } catch (error) {
      this.log.warn(`Failed to load token stats: ${error}`);
    }

    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUpdated: new Date()
    };
  }

  /**
   * 保存统计数据
   */
  private save(): void {
    try {
      writeFileSync(this.statsFile, JSON.stringify(this.stats, null, 2), 'utf-8');
    } catch (error) {
      this.log.error(`Failed to save token stats: ${error}`);
    }
  }

  /**
   * 记录一次 token 使用
   */
  record(promptTokens: number, completionTokens: number, totalTokens: number): void {
    this.stats.promptTokens += promptTokens;
    this.stats.completionTokens += completionTokens;
    this.stats.totalTokens += totalTokens;
    this.stats.requestCount += 1;
    this.stats.lastUpdated = new Date();
    this.dirty = true;
  }

  /**
   * 获取当前统计
   */
  getStats(): TokenUsage {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  reset(): void {
    this.stats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      lastUpdated: new Date()
    };
    this.dirty = true;
    this.save();
    this.log.info('Token stats reset');
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.dirty) {
      this.save();
    }
  }
}

/**
 * 全局 token 统计管理器
 */
export const tokenStats = new TokenStatsManager();

