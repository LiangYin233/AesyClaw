import { ConfigLoader } from '../../config/loader.js';
import { logger, tokenUsage } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child('Bootstrap');

export function setupSignalHandlers(services: Services): void {
  const shutdown = async () => {
    log.info('正在关闭服务');
    const { agentRuntime, channelManager, sessionManager, cronService, skillManager } = services;
    agentRuntime.stop();
    await skillManager?.stopWatching();
    await channelManager.stopAll();
    await (cronService as any).stop?.();
    await tokenUsage.destroy();
    await sessionManager.close();
    ConfigLoader.stopWatching();
    log.info('所有服务已停止');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
