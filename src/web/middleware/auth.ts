/** Bearer token 认证中间件。 */

import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { ConfigManager } from '../../core/config/config-manager';

/**
 * 创建 Bearer token 认证中间件。
 *
 * @param configManager - 配置管理器，用于获取 authToken
 * @returns Hono 中间件处理器
 */
export function createAuthMiddleware(configManager: ConfigManager): MiddlewareHandler {
  return async (c, next) => {
    const authToken = configManager.getConfig().server.authToken;

    // 如果没有配置认证令牌，允许所有请求
    if (!authToken) {
      return await next();
    }

    const header = c.req.header('Authorization');
    if (header && header.startsWith('Bearer ')) {
      const token = header.slice(7);
      if (token === authToken) {
        return await next();
      }
    }

    const cookieToken = getCookie(c, 'aesyclaw_token');
    if (cookieToken && cookieToken === authToken) {
      return await next();
    }

    return c.json({ ok: false, error: '未授权' }, 401);
  };
}
