/**
 * AesyClaw — entry point.
 *
 * Creates the Application instance and starts it.
 * Registers signal handlers for graceful shutdown.
 */

import { Application } from './app';

async function main(): Promise<void> {
  const app = new Application();

  // Graceful shutdown on signals
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down…`);
    await app.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('uncaughtException', async (err) => {
    console.error('Uncaught exception:', err);
    await app.shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled rejection:', reason);
    await app.shutdown();
    process.exit(1);
  });

  try {
    await app.start();
  } catch (err) {
    console.error('Failed to start AesyClaw:', err);
    process.exit(1);
  }
}

main();
