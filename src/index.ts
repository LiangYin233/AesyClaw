import { bootstrap, Bootstrap } from './bootstrap.js';
import { pipeline } from './agent/core/pipeline.js';
import { toolRegistry } from './platform/tools/registry.js';
import { logger } from './platform/observability/logger.js';

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

export { pipeline, toolRegistry };
