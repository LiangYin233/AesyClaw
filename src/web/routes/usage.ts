/** Usage API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import { createScopedLogger } from '../../core/logger';

const logger = createScopedLogger('webui:usage');

export function createUsageRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', async (c) => {
    try {
      const model = c.req.query('model');
      const from = c.req.query('from');
      const to = c.req.query('to');

      const data = await deps.databaseManager.usage.getStats({ model, from, to });
      return c.json({ ok: true, data });
    } catch (err) {
      logger.error('Failed to get usage stats', err);
      return c.json({ ok: false, error: 'Failed to get usage stats' }, 500);
    }
  });

  router.get('/today', async (c) => {
    try {
      const data = await deps.databaseManager.usage.getTodaySummary();
      return c.json({ ok: true, data });
    } catch (err) {
      logger.error('Failed to get today usage summary', err);
      return c.json({ ok: false, error: 'Failed to get today usage summary' }, 500);
    }
  });

  return router;
}
