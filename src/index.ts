import { bootstrap, getStatus, shutdown } from '@/runtime/bootstrap.js';
import { logger } from '@/platform/observability/logger.js';

let shutdownPromise: Promise<void> | null = null;

async function shutdownRuntime(reason: string, error?: unknown): Promise<void> {
  if (!shutdownPromise) {
    if (error) {
      logger.fatal({ error }, reason);
    } else {
      logger.info({}, reason);
    }

    shutdownPromise = shutdown().catch((shutdownError) => {
      logger.error({ error: shutdownError }, 'Runtime shutdown failed');
    });
  }

  await shutdownPromise;
}

function registerProcessHandlers(): void {
  process.once('SIGINT', () => {
    void shutdownRuntime('Received SIGINT, shutting down runtime').finally(() => {
      process.exit(0);
    });
  });

  process.once('SIGTERM', () => {
    void shutdownRuntime('Received SIGTERM, shutting down runtime').finally(() => {
      process.exit(0);
    });
  });

  process.once('uncaughtException', (error) => {
    void shutdownRuntime('Uncaught exception detected', error).finally(() => {
      process.exit(1);
    });
  });

  process.once('unhandledRejection', (reason) => {
    void shutdownRuntime('Unhandled promise rejection detected', reason).finally(() => {
      process.exit(1);
    });
  });
}

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

registerProcessHandlers();
void main();
