import { ConfigLoader } from '../../config/loader.js';
import { logger, tokenUsage } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child('Bootstrap');

export async function shutdownServices(services: Services): Promise<void> {
  const cleanupErrors: unknown[] = [];
  const recordCleanupError = (step: string, error: unknown): void => {
    cleanupErrors.push(error);
    log.error(`关闭步骤失败: ${step}`, { error });
  };

  const runStep = async (step: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      recordCleanupError(step, error);
    }
  };

  const { agentRuntime, apiServer, channelManager, sessionManager, cronService, skillManager, configManager } = services;
  agentRuntime.stop();
  configManager.dispose();

  await runStep('skill watchers', async () => {
    await skillManager?.stopWatching();
  });
  await runStep('api server', async () => {
    await apiServer?.stop();
  });
  await runStep('channel manager', async () => {
    await channelManager.stopAll();
  });
  await runStep('cron service', async () => {
    await Promise.resolve((cronService as any).stop?.());
  });
  await runStep('token usage store', async () => {
    await tokenUsage.destroy();
  });
  await runStep('session manager', async () => {
    await sessionManager.close();
  });

  ConfigLoader.stopWatching();

  if (cleanupErrors.length > 0) {
    throw cleanupErrors[0];
  }
}

export function setupSignalHandlers(services: Services): void {
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    log.info('正在关闭服务');

    let exitCode = 0;
    try {
      await shutdownServices(services);
      log.info('所有服务已停止');
    } catch (error) {
      exitCode = 1;
      log.error('服务关闭时发生错误', { error });
    }

    process.exit(exitCode);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}
