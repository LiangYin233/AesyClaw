import { ConfigLoader } from '../../config/loader.js';
import { logger } from '../../observability/index.js';
import type { Services } from '../factory/ServiceFactory.js';

const log = logger.child('Bootstrap');

export function setupSignalHandlers(services: Services): void {
  const shutdown = async () => {
    log.info('Shutting down...');
    const { agentRuntime, channelManager, sessionManager, cronService } = services;
    agentRuntime.stop();
    await channelManager.stopAll();
    await (cronService as any).stop?.();
    await sessionManager.close();
    ConfigLoader.stopWatching();
    log.info('All services stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
