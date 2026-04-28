/** Bearer token authentication middleware. */

import type { MiddlewareHandler } from 'hono';
import type { ConfigManager } from '../../core/config/config-manager';

export function createAuthMiddleware(configManager: ConfigManager): MiddlewareHandler {
  return async (c, next) => {
    const authToken = configManager.getConfig().server.authToken;

    // If no auth token is configured, allow all requests
    if (!authToken) {
      return next();
    }

    const header = c.req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ ok: false, error: 'Unauthorized' }, 401);
    }

    const token = header.slice(7);
    if (token !== authToken) {
      return c.json({ ok: false, error: 'Invalid token' }, 401);
    }

    return next();
  };
}
