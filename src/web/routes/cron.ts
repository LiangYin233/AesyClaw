/** Cron API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

/**
 * 创建定时任务 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createCronRouter(deps: WebUiManagerDependencies): Hono {
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
