/**
 * 配置访问器接口
 *
 * 提供统一的配置访问方式，避免 Features 之间直接引用 config 模块。
 *
 * 使用方式：
 * 1. 通过依赖注入获取配置访问器
 * 2. 使用类型安全的 getter 方法访问配置
 * 3. 监听配置变更事件
 */

import type { Config } from '../../types.js';

/**
 * 配置访问器接口
 */
export interface IConfigAccessor {
  /**
   * 获取当前配置快照
   */
  getConfig(): Config;

  /**
   * 获取配置中的任意字段
   */
  get<T>(path: string): T | undefined;

  /**
   * 获取配置中的必填字段
   */
  getRequired<T>(path: string): T;

  /**
   * 监听配置变更
   */
  onChange(listener: ConfigChangeListener): () => void;
}

/**
 * 配置变更监听器
 */
export type ConfigChangeListener = (
  previous: Config | null,
  current: Config
) => void | Promise<void>;

/**
 * 配置变更事件
 */
export interface ConfigChangeEvent {
  previous: Config | null;
  current: Config;
}

/**
 * 创建配置访问器
 */
export function createConfigAccessor(configStore: ConfigStore): IConfigAccessor {
  return new ConfigAccessorImpl(configStore);
}

/**
 * 配置存储接口
 */
export interface ConfigStore {
  getConfig(): Config;
  onReload(listener: (previous: Config | null, current: Config) => void): () => void;
}

/**
 * 配置访问器实现
 */
class ConfigAccessorImpl implements IConfigAccessor {
  constructor(private configStore: ConfigStore) {}

  getConfig(): Config {
    return this.configStore.getConfig();
  }

  get<T>(path: string): T | undefined {
    const config = this.getConfig();
    return getByPath(config, path) as T | undefined;
  }

  getRequired<T>(path: string): T {
    const value = this.get<T>(path);
    if (value === undefined) {
      throw new Error(`配置项 ${path} 不存在`);
    }
    return value;
  }

  onChange(listener: ConfigChangeListener): () => void {
    return this.configStore.onReload(listener);
  }
}

/**
 * 辅助函数：按路径获取配置值
 */
function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
