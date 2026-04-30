import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../src/core/logger', () => ({
  createScopedLogger: () => logger,
}));

beforeAll(async () => {
  // Warm the ESM module cache — the first dynamic import resolves
  // the full module graph (index → app → 18 subsystems) and can
  // take several seconds on Windows. Subsequent calls are instant.
  await import('../../src/index');
});

beforeEach(() => {
  vi.clearAllMocks();
});

async function importEntrypoint() {
  return await import('../../src/index');
}

describe('index entrypoint', () => {
  it('logs graceful shutdowns through the scoped logger', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const processRef = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
        return processRef;
      }),
      exit: vi.fn(),
    };
    const app = {
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    const { registerProcessHandlers } = await importEntrypoint();
    registerProcessHandlers(app, processRef);

    await handlers.get('SIGINT')?.();

    expect(logger.info).toHaveBeenCalledWith('Received SIGINT, shutting down…');
    expect(app.shutdown).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(0);
  });

  it('logs uncaught exceptions through the scoped logger before shutdown', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const processRef = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, handler);
        return processRef;
      }),
      exit: vi.fn(),
    };
    const app = {
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
    const error = new Error('boom');

    const { registerProcessHandlers } = await importEntrypoint();
    registerProcessHandlers(app, processRef);

    await handlers.get('uncaughtException')?.(error);
    await Promise.resolve();

    expect(logger.error).toHaveBeenCalledWith('Uncaught exception', error);
    expect(app.shutdown).toHaveBeenCalledTimes(1);
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });

  it('logs startup failures through the scoped logger', async () => {
    const processRef = {
      on: vi.fn(),
      exit: vi.fn(),
    };
    const error = new Error('start failed');
    const app = {
      start: vi.fn().mockRejectedValue(error),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    const { main } = await importEntrypoint();
    await main(app, processRef);

    expect(logger.error).toHaveBeenCalledWith('Failed to start AesyClaw', error);
    expect(processRef.exit).toHaveBeenCalledWith(1);
  });
});
