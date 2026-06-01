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
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`收到 ${signal}，正在关闭…`);
    await app.shutdown();
    processRef.exit(0);
  };

  const handleSignal = (signal: string): Promise<void> =>
    shutdown(signal).catch((err) => {
      logger.error(`${signal} 关闭过程中失败`, err);
      processRef.exit(1);
    });

  processRef.on('SIGINT', () => {
    void handleSignal('SIGINT');
  });
  processRef.on('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });

  processRef.on('uncaughtException', (err) => {
    void (async () => {
      logger.error('未捕获的异常', err);
      await app.shutdown();
      processRef.exit(1);
    })();
  });

  processRef.on('unhandledRejection', (reason) => {
    void (async () => {
      logger.error('未处理的 Promise 拒绝', reason);
      await app.shutdown();
      processRef.exit(1);
    })();
  });
}

async function createDefaultApplication(): Promise<AppLifecycle> {
  const { Application } = await import('./app');
  return new Application();
}

export async function main(
  app?: AppLifecycle,
  processRef: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): Promise<void> {
  try {
    const runningApp = app ?? (await createDefaultApplication());
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
