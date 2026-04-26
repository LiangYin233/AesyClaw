/**
 * AesyClaw — entry point.
 *
 * Creates the Application instance and starts it.
 * Registers signal handlers for graceful shutdown.
 */

import { pathToFileURL } from 'node:url';
import { Application } from './app';
import { createScopedLogger } from './core/logger';

const logger = createScopedLogger('app');

type AppLifecycle = Pick<Application, 'start' | 'shutdown'>;

export function registerProcessHandlers(
  app: Pick<AppLifecycle, 'shutdown'>,
  processRef: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): void {
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down…`);
    await app.shutdown();
    processRef.exit(0);
  };

  const handleSignal = (signal: string) =>
    shutdown(signal).catch((err) => {
      logger.error(`Failed during ${signal} shutdown`, err);
      processRef.exit(1);
    });

  processRef.on('SIGINT', () => handleSignal('SIGINT'));
  processRef.on('SIGTERM', () => handleSignal('SIGTERM'));

  processRef.on('uncaughtException', (err) => {
    void (async () => {
      logger.error('Uncaught exception', err);
      await app.shutdown();
      processRef.exit(1);
    })();
  });

  processRef.on('unhandledRejection', (reason) => {
    void (async () => {
      logger.error('Unhandled rejection', reason);
      await app.shutdown();
      processRef.exit(1);
    })();
  });
}

export async function main(
  app: AppLifecycle = new Application(),
  processRef: Pick<NodeJS.Process, 'on' | 'exit'> = process,
): Promise<void> {
  registerProcessHandlers(app, processRef);

  try {
    await app.start();
  } catch (err) {
    logger.error('Failed to start AesyClaw', err);
    processRef.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
