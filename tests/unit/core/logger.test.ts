import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentLogEntriesForTests,
  createScopedLogger,
  getRecentLogEntries,
  setLogLevel,
} from '../../../src/core/logger';

const FIXED_TIME = new Date('2026-04-26T12:34:56.789Z');
const FORMATTED_TIME = `${String(FIXED_TIME.getMonth() + 1).padStart(2, '0')}-${String(FIXED_TIME.getDate()).padStart(2, '0')} ${String(FIXED_TIME.getHours()).padStart(2, '0')}:${String(FIXED_TIME.getMinutes()).padStart(2, '0')}:${String(FIXED_TIME.getSeconds()).padStart(2, '0')}`;

describe('scoped logger', () => {
  const logger = createScopedLogger('app');
  const originalStdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  const originalStderrTTY = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setLogLevel('info');
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    process.env.TERM = 'xterm-256color';
    clearRecentLogEntriesForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setLogLevel('info');
    restoreTTY(process.stdout, originalStdoutTTY);
    restoreTTY(process.stderr, originalStderrTTY);
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    clearRecentLogEntriesForTests();
  });

  it('falls back to plain text for non-interactive info logs', () => {
    setTTY(process.stdout, false);

    logger.info('Ready', { port: 3000 });

    expect(console.info).toHaveBeenCalledWith(`${FORMATTED_TIME} [INFO] [app] Ready`, {
      port: 3000,
    });
  });

  it('colorizes level and scope for interactive info logs', () => {
    setTTY(process.stdout, true);

    logger.info('Ready');

    expect(console.info).toHaveBeenCalledWith(
      `${FORMATTED_TIME} \x1b[36m[INFO]\x1b[0m \x1b[36m[app]\x1b[0m Ready`,
    );
  });

  it('uses stderr color support for warn logs', () => {
    setTTY(process.stdout, false);
    setTTY(process.stderr, true);

    logger.warn('Watch out');

    expect(console.warn).toHaveBeenCalledWith(
      `${FORMATTED_TIME} \x1b[33m[WARN]\x1b[0m \x1b[33m[app]\x1b[0m Watch out`,
    );
  });

  it('falls back to plain text for redirected warn logs', () => {
    setTTY(process.stdout, true);
    setTTY(process.stderr, false);

    logger.warn('Watch out');

    expect(console.warn).toHaveBeenCalledWith(`${FORMATTED_TIME} [WARN] [app] Watch out`);
  });

  it('disables colors when NO_COLOR is set', () => {
    setTTY(process.stdout, true);
    process.env.NO_COLOR = '1';

    logger.info('Ready');

    expect(console.info).toHaveBeenCalledWith(`${FORMATTED_TIME} [INFO] [app] Ready`);
  });

  it('prefers NO_COLOR over FORCE_COLOR', () => {
    setTTY(process.stdout, true);
    process.env.NO_COLOR = '1';
    process.env.FORCE_COLOR = '1';

    logger.info('Ready');

    expect(console.info).toHaveBeenCalledWith(`${FORMATTED_TIME} [INFO] [app] Ready`);
  });

  it('falls back to plain text when terminal support is dumb', () => {
    setTTY(process.stdout, true);
    process.env.TERM = 'dumb';

    logger.info('Ready');

    expect(console.info).toHaveBeenCalledWith(`${FORMATTED_TIME} [INFO] [app] Ready`);
  });

  it('preserves log level filtering', () => {
    setTTY(process.stderr, true);
    setLogLevel('error');

    logger.warn('Skipped');
    logger.error('Failed');

    expect(console.warn).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      `${FORMATTED_TIME} \x1b[31m[ERROR]\x1b[0m \x1b[31m[app]\x1b[0m Failed`,
    );
  });

  it('captures recent log entries without ANSI colors', () => {
    setTTY(process.stdout, true);

    logger.info('Ready', { port: 3000 });

    expect(getRecentLogEntries()).toEqual([
      {
        id: 1,
        timestamp: FORMATTED_TIME,
        level: 'info',
        scope: 'app',
        message: 'Ready',
        details: '{ port: 3000 }',
        formatted: `${FORMATTED_TIME} [INFO] [app] Ready { port: 3000 }`,
      },
    ]);
  });

  it('does not capture filtered log entries', () => {
    setLogLevel('error');

    logger.warn('Skipped');
    logger.error('Failed');

    expect(getRecentLogEntries()).toEqual([
      {
        id: 1,
        timestamp: FORMATTED_TIME,
        level: 'error',
        scope: 'app',
        message: 'Failed',
        details: null,
        formatted: `${FORMATTED_TIME} [ERROR] [app] Failed`,
      },
    ]);
  });
});

function setTTY(stream: NodeJS.WriteStream, value: boolean): void {
  Object.defineProperty(stream, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreTTY(stream: NodeJS.WriteStream, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) {
    Object.defineProperty(stream, 'isTTY', descriptor);
    return;
  }

  Reflect.deleteProperty(stream, 'isTTY');
}
