/** Logs API routes. */

import { Hono } from 'hono';
import { createScopedLogger, getRecentLogEntries } from '../../core/logger';
import type { WebUiManagerDependencies } from '../webui-manager';

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 500;
const logger = createScopedLogger('webui:logs');

function parseLimit(limitRaw: string | undefined): number {
  if (!limitRaw) {
    return DEFAULT_LOG_LIMIT;
  }

  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LOG_LIMIT;
  }

  return Math.min(parsed, MAX_LOG_LIMIT);
}

export function createLogsRouter(_deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    try {
      const limit = parseLimit(c.req.query('limit'));

      return c.json({
        ok: true,
        data: {
          entries: getRecentLogEntries(limit),
          limit,
        },
      });
    } catch (err) {
      logger.error('Failed to get recent logs', err);
      return c.json({ ok: false, error: 'Failed to get recent logs' }, 500);
    }
  });

  return router;
}
