/** 用量 API 路由。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import { createScopedLogger } from '../../core/logger';

const logger = createScopedLogger('webui:usage');

/**
 * 创建用量 API 路由。
 *
 * @param deps - WebUiManager 的依赖项
 * @returns Hono 路由器实例
 */
export function createUsageRouter(deps: WebUiManagerDependencies): Hono {
  const router = new Hono();

  router.get('/', async (c) => {
    try {
      const model = c.req.query('model');
      const from = c.req.query('from');
      const to = c.req.query('to');

      const data = await deps.databaseManager.usage.getStats({ model, from, to });
      return c.json({ ok: true, data });
    } catch (err) {
      logger.error('获取用量统计失败', err);
      return c.json({ ok: false, error: '获取用量统计失败' }, 500);
    }
  });

  router.get('/today', async (c) => {
    try {
      const data = await deps.databaseManager.usage.getTodaySummary();
      return c.json({ ok: true, data });
    } catch (err) {
      logger.error('获取今日用量汇总失败', err);
      return c.json({ ok: false, error: '获取今日用量汇总失败' }, 500);
    }
  });

  router.get('/tools', async (c) => {
    try {
      const from = c.req.query('from');
      const to = c.req.query('to');

      const data = await deps.databaseManager.toolUsage.getStats({ from, to });
      return c.json({ ok: true, data });
    } catch (err) {
      logger.error('获取工具调用统计失败', err);
      return c.json({ ok: false, error: '获取工具调用统计失败' }, 500);
    }
  });

  return router;
}
