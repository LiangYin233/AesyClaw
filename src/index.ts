import { logger } from './platform/observability/logger.js';
import { Bootstrap, bootstrap } from './bootstrap.js';

async function main() {
  try {
    await bootstrap();
  } catch (error) {
    logger.error({ error }, 'Bootstrap failed');
    process.exit(1);
  }

  const status = Bootstrap.getStatus();
  logger.info({ toolCount: status.toolRegistry.totalTools, status }, 'System ready');
}

main().catch(console.error);

export const getPipeline = () => Bootstrap.getPipeline();
