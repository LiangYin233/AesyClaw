/** 串行执行器 — 防重入 + 排队，消除 ChannelManager/PluginManager/McpManager 中重复的防重入队列模式。 */

import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('serial-executor');

export class SerialExecutor {
  private running = false;
  private pending = false;
  private promise: Promise<void> | null = null;

  async execute(fn: () => Promise<void>, label?: string): Promise<void> {
    if (this.running) {
      this.pending = true;
      logger.debug(`${label ?? '操作'}已在进行中 — 排队等待下一次执行`);
      return await (this.promise ?? Promise.resolve());
    }

    this.running = true;
    this.promise = (async () => {
      try {
        do {
          this.pending = false;
          await fn();
        } while (this.pending);
      } finally {
        this.running = false;
        this.promise = null;
      }
    })();

    return await this.promise;
  }
}
