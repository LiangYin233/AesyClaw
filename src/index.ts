import { bootstrap, getStatus } from '@/bootstrap.js';
import { logger } from '@/platform/observability/logger.js';

async function main(): Promise<void> {
  try {
    await bootstrap();
  } catch (error) {
    logger.error({ error }, 'Bootstrap failed');
    process.exit(1);
  }

  const status = getStatus();
  logger.info({ toolCount: status.toolRegistry.totalTools, status }, 'System ready');
}

void main();

export { bootstrap, shutdown } from '@/bootstrap.js';
