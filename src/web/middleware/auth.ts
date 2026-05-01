/** Bearer token 认证中间件。 */

import { getCookie } from 'hono/cookie';
import { timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { ConfigManager } from '../../core/config/config-manager';

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

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
      if (safeTokenEqual(token, authToken)) {
        return await next();
      }
    }

    const cookieToken = getCookie(c, 'aesyclaw_token');
    if (cookieToken && safeTokenEqual(cookieToken, authToken)) {
      return await next();
    }

    return c.json({ ok: false, error: '未授权' }, 401);
  };
}
