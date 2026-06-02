/**
 * AesyClaw — 入口文件。
 *
 * 创建 Application 实例并启动。
 * 注册信号处理器以实现优雅关闭。
 */

import { pathToFileURL } from 'node:url';
import type { Application } from './app';
import { createScopedLogger } from './core/logger';

const logger = createScopedLogger('app');

type AppLifecycle = Pick<Application, 'start' | 'shutdown'>;

export function registerProcessHandlers(
  app: Pick<AppLifecycle, 'shutdown'>,
  processRef: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): void {
  const exitAfterShutdown = async (label: string, code: number): Promise<void> => {
    try {
      await app.shutdown();
      processRef.exit(code);
    } catch (err) {
      logger.error(`${label} 关闭过程中失败`, err);
      processRef.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    processRef.on(signal, () => {
      logger.info(`收到 ${signal}，正在关闭…`);
      void exitAfterShutdown(signal, 0);
    });
  }

  processRef.on('uncaughtException', (err) => {
    logger.error('未捕获的异常', err);
    void exitAfterShutdown('uncaughtException', 1);
  });

  processRef.on('unhandledRejection', (reason) => {
    logger.error('未处理的 Promise 拒绝', reason);
    void exitAfterShutdown('unhandledRejection', 1);
  });
}

export async function main(
  app?: AppLifecycle,
  processRef: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): Promise<void> {
  try {
    const runningApp = app ?? new (await import('./app')).Application();
    registerProcessHandlers(runningApp, processRef);
    await runningApp.start();
  } catch (err) {
    logger.error('启动 AesyClaw 失败', err);
    processRef.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
