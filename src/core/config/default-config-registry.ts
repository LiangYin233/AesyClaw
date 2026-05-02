/**
 * DefaultConfigRegistry — 管理子系统的默认配置注册与合并。
 *
 * 负责 registerDefaults、syncDefaults 时的点号键解析和合并。
 */

import type { AppConfig } from './schema';
import { mergeDefaults } from '../utils';

export class DefaultConfigRegistry {
  private registeredDefaults = new Map<string, Record<string, unknown>>();

  /** 为子系统注册默认值 */
  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.registeredDefaults.set(key, defaults);
  }

  /** 将已注册的默认值合并到给定配置中 */
  mergeInto(config: AppConfig): AppConfig {
    let mergedConfig = structuredClone(config);

    for (const [key, defaults] of this.registeredDefaults) {
      // 支持点号键，如 'channels.testchannel'
      const nestedPartial = this.buildNestedObject(key, defaults);
      mergedConfig = mergeDefaults(
        mergedConfig as Record<string, unknown>,
        nestedPartial as Record<string, unknown>,
        { overwrite: false },
      ) as AppConfig;
    }

    return mergedConfig;
  }

  /**
   * 将点号键（如 'channels.testchannel'）和值
   * 转换为嵌套对象：{ channels: { testchannel: value } }
   */
  private buildNestedObject(key: string, value: Record<string, unknown>): Record<string, unknown> {
    const parts = key.split('.');
    const result: Record<string, unknown> = {};
    let current = result;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = value;
      } else {
        current[part] = {};
        current = current[part] as Record<string, unknown>;
      }
    }

    return result;
  }
}
