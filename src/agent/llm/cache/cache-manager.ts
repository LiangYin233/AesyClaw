/**
 * 缓存管理器模块
 * 提供请求缓存机制，减少重复请求的 API 调用
 * 支持 TTL（Time To Live）过期机制和 LRU（Least Recently Used）淘汰策略
 */

/**
 * 缓存条目接口
 */
interface CacheEntry<T> {
  /** 缓存值 */
  value: T;
  /** 创建时间戳（毫秒） */
  timestamp: number;
  /** 过期时间（毫秒） */
  ttl: number;
  /** 最后访问时间戳（毫秒） */
  lastAccessed: number;
}

/**
 * 缓存统计信息接口
 */
export interface CacheStats {
  /** 当前缓存条目数量 */
  size: number;
  /** 最大容量 */
  maxSize: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 过期清理次数 */
  evictions: number;
  /** 总请求数 */
  totalRequests: number;
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  /** 默认 TTL（毫秒），默认 1 小时 */
  defaultTTL?: number;
  /** 最大容量，默认 1000 */
  maxSize?: number;
  /** 清理间隔（毫秒），默认 1 分钟 */
  cleanupInterval?: number;
}

/**
 * 缓存管理器类
 * 实现 TTL 过期机制和 LRU 淘汰策略
 */
export class CacheManager<T = unknown> {
  /** 缓存存储 */
  private cache: Map<string, CacheEntry<T>> = new Map();

  /** 默认 TTL（毫秒） */
  private defaultTTL: number;

  /** 最大容量 */
  private maxSize: number;

  /** 清理间隔（毫秒） */
  private cleanupInterval: number;

  /** 清理定时器 */
  private cleanupTimer?: NodeJS.Timeout;

  /** 统计信息 */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  /**
   * 构造函数
   * @param config 缓存配置
   */
  constructor(config: CacheConfig = {}) {
    this.defaultTTL = config.defaultTTL ?? 60 * 60 * 1000; // 默认 1 小时
    this.maxSize = config.maxSize ?? 1000; // 默认最大容量 1000
    this.cleanupInterval = config.cleanupInterval ?? 60 * 1000; // 默认 1 分钟清理一次

    // 启动定期清理
    this.startCleanup();
  }

  /**
   * 获取缓存
   * @param key 缓存键
   * @returns 缓存值，如果不存在或已过期则返回 undefined
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    // 缓存不存在
    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    // 检查是否过期
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // 更新最后访问时间（LRU）
    entry.lastAccessed = Date.now();
    this.stats.hits++;

    return entry.value;
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param value 缓存值
   * @param ttl 过期时间（毫秒），不指定则使用默认 TTL
   * @returns 是否设置成功
   */
  set(key: string, value: T, ttl?: number): boolean {
    // 检查容量，如果达到上限则淘汰最旧条目
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      timestamp: now,
      ttl: ttl ?? this.defaultTTL,
      lastAccessed: now,
    };

    this.cache.set(key, entry);
    return true;
  }

  /**
   * 删除缓存
   * @param key 缓存键
   * @returns 是否删除成功
   */
  clear(): void {
    this.cache.clear();
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.evictions = 0;
  }

  getStats(): CacheStats {
    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate,
      evictions: this.stats.evictions,
      totalRequests,
    };
  }

  /**
   * 检查缓存是否存在
   * @param key 缓存键
   * @returns 是否存在
   */
  private cleanup(): number {
    let cleaned = 0;
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.stats.evictions += cleaned;
    }

    return cleaned;
  }

  /**
   * 销毁缓存管理器
   * 停止定时清理任务
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }

  /**
   * 检查缓存条目是否过期
   * @param entry 缓存条目
   * @returns 是否过期
   */
  private isExpired(entry: CacheEntry<T>): boolean {
    const now = Date.now();
    return now - entry.timestamp > entry.ttl;
  }

  /**
   * 淘汰最久未使用的条目（LRU 策略）
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    // 找到最久未使用的条目
    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    // 删除最久未使用的条目
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);

    // 确保定时器不会阻止进程退出
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
