/** Cron API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

export function createCronRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', async (c) => {
    const jobs = await deps.cronManager.listJobs();
    return c.json({ ok: true, data: jobs });
  });

  router.get('/:id/runs', async (c) => {
    const jobId = c.req.param('id');
    const runs = await deps.databaseManager.cronRuns.findByJobId(jobId);
    return c.json({ ok: true, data: runs });
  });

  return router;
}
