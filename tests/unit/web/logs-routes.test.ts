import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearRecentLogEntriesForTests,
  createScopedLogger,
} from '../../../src/core/logger';
import * as loggerModule from '../../../src/core/logger';
import { createLogsRouter } from '../../../src/web/routes/logs';
import type { WebUiManagerDependencies } from '../../../src/web/webui-manager';

function makeDeps() {
  return {} as WebUiManagerDependencies;
}

describe('logs routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearRecentLogEntriesForTests();
  });

  it('returns recent log entries in the standard ok/data shape', async () => {
    clearRecentLogEntriesForTests();
    const logger = createScopedLogger('test:logs');
    logger.info('First message');
    logger.warn('Second message', { detail: true });

    const router = createLogsRouter(makeDeps());
    const response = await router.request('/?limit=2');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.limit).toBe(2);
    expect(body.data.entries).toHaveLength(2);
    expect(body.data.entries[0]).toMatchObject({
      level: 'info',
      scope: 'test:logs',
      message: 'First message',
    });
    expect(body.data.entries[1]).toMatchObject({
      level: 'warn',
      scope: 'test:logs',
      message: 'Second message',
      details: '{ detail: true }',
    });
  });

  it('falls back to default limit for invalid values and clamps oversized requests', async () => {
    clearRecentLogEntriesForTests();
    const logger = createScopedLogger('test:logs');
    logger.info('Only message');

    const router = createLogsRouter(makeDeps());
    const invalidResponse = await router.request('/?limit=0');
    const invalidBody = await invalidResponse.json();
    const clampedResponse = await router.request('/?limit=9999');
    const clampedBody = await clampedResponse.json();

    expect(invalidBody.data.limit).toBe(200);
    expect(clampedBody.data.limit).toBe(500);
    expect(clampedBody.data.entries).toHaveLength(1);
  });

  it('returns the standard error shape when reading logs fails', async () => {
    vi.spyOn(loggerModule, 'getRecentLogEntries').mockImplementation(() => {
      throw new Error('boom');
    });

    const router = createLogsRouter(makeDeps());
    const response = await router.request('/');
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'Failed to get recent logs' });
  });
});
