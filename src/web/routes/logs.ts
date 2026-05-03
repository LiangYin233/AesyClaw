/** 日志 API 路由。 */

import { Hono } from 'hono';
import { createScopedLogger, getRecentLogEntries } from '@aesyclaw/core/logger';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

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

/**
 * 创建日志 API 路由。
 *
 * @param _deps - WebUiManager 的依赖项（当前未使用）
 * @returns Hono 路由器实例
 */
export function createLogsRouter(_deps: WebUiManagerDependencies): Hono {
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
      logger.error('获取最近日志失败', err);
      return c.json({ ok: false, error: '获取最近日志失败' }, 500);
    }
  });

  return router;
}
