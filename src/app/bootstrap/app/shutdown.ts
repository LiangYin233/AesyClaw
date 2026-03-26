import { tokenUsage } from '../../../platform/observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

export async function shutdownServices(services: Services): Promise<void> {
  const cleanupErrors: unknown[] = [];
  const recordCleanupError = (step: string, error: unknown): void => {
    cleanupErrors.push(error);
  };

  const runStep = async (step: string, operation: () => Promise<void>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      recordCleanupError(step, error);
    }
  };

  const { agentRuntime, apiServer, channelManager, sessionManager, cronService, skillManager, configManager, mcpManager } = services;
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
  await runStep('mcp manager', async () => {
    await mcpManager?.close();
  });
  await runStep('token usage store', async () => {
    await tokenUsage.destroy();
  });
  await runStep('session manager', async () => {
    await sessionManager.close();
  });
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

    let exitCode = 0;
    try {
      await shutdownServices(services);
    } catch {
      exitCode = 1;
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
