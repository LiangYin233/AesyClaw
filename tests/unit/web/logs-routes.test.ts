import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearRecentLogEntriesForTests, createScopedLogger } from '../../../src/core/logger';
import * as loggerModule from '../../../src/core/logger';
import { getLogs } from '../../../src/web/services/logs';

describe('logs service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRecentLogEntriesForTests();
  });

  it('returns recent log entries', () => {
    clearRecentLogEntriesForTests();
    const logger = createScopedLogger('test:logs');
    logger.info('First message');
    logger.warn('Second message', { detail: true });

    const result = getLogs({ limit: '2' });

    expect(result.limit).toBe(2);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      level: 'info',
      scope: 'test:logs',
      message: 'First message',
    });
    expect(result.entries[1]).toMatchObject({
      level: 'warn',
      scope: 'test:logs',
      message: 'Second message',
      details: '{ detail: true }',
    });
  });

  it('falls back to default limit for invalid values and clamps oversized requests', () => {
    clearRecentLogEntriesForTests();
    const logger = createScopedLogger('test:logs');
    logger.info('Only message');

    const invalidResult = getLogs({ limit: '0' });
    const clampedResult = getLogs({ limit: '9999' });

    expect(invalidResult.limit).toBe(200);
    expect(clampedResult.limit).toBe(500);
    expect(clampedResult.entries).toHaveLength(1);
  });

  it('throws when reading logs fails', () => {
    vi.spyOn(loggerModule, 'getRecentLogEntries').mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => getLogs()).toThrow('获取最近日志失败');
  });
});
