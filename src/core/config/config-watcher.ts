/**
 * ConfigWatcher — 监视配置文件的外部变更。
 *
 * 负责 fs.watch 设置和清理、debounce、selfUpdating 守卫。
 */

import fs from 'node:fs';
import { createScopedLogger } from '../logger';

const logger = createScopedLogger('config-watcher');

export class ConfigWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private selfUpdating = false;
  private readonly DEBOUNCE_MS = 300;

  /** 开始监视配置文件的外部变更 */
  start(configPath: string, onChange: () => void): void {
    if (this.watcher) {
      return; // 已在监视中
    }

    this.watcher = fs.watch(configPath, () => {
      this.handleFileChange(onChange);
    });

    // 同时监听 'error' 事件以防止崩溃
    this.watcher.on('error', (err) => {
      logger.error('配置文件监视器错误', err);
    });

    logger.info('热重载监视器已启动');
  }

  /** 停止监视配置文件 */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('热重载监视器已停止');
    }
  }

  /** 设置 selfUpdating 守卫，防止自身写入触发重载 */
  setSelfUpdating(value: boolean): void {
    this.selfUpdating = value;
  }

  /** 获取 selfUpdating 状态 */
  isSelfUpdating(): boolean {
    return this.selfUpdating;
  }

  /** 获取防抖延迟毫秒数 */
  getDebounceMs(): number {
    return this.DEBOUNCE_MS;
  }

  private handleFileChange(onChange: () => void): void {
    // 如果刚写入文件 ourselves，则跳过
    if (this.selfUpdating) {
      return;
    }

    // 防抖：合并快速变更事件
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      onChange();
    }, this.DEBOUNCE_MS);
  }
}
