/** Config API routes. */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';
import { AppConfigSchema, type AppConfig } from '../../core/config/schema';
import type { DeepPartial } from '../../core/types';

export function createConfigRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const config = deps.configManager.getConfig();
    return c.json({ ok: true, data: maskSecrets(config) });
  });

  router.get('/schema', (c) => {
    return c.json({ ok: true, data: AppConfigSchema });
  });

  router.put('/', async (c) => {
    try {
      const body = await c.req.json();
      const safeUpdate = restoreMaskedSecrets(deps.configManager.getConfig(), body) as DeepPartial<AppConfig>;
      await deps.configManager.update(safeUpdate);
      return c.json({ ok: true, data: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: message }, 400);
    }
  });

  return router;
}

function maskSecrets(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(maskSecrets);
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSecretKey(key)) {
      result[key] = '***';
    } else {
      result[key] = maskSecrets(val);
    }
  }
  return result;
}

function restoreMaskedSecrets(previous: unknown, incoming: unknown): unknown {
  if (typeof incoming !== 'object' || incoming === null) {
    return incoming;
  }

  if (Array.isArray(incoming)) {
    const previousArray = Array.isArray(previous) ? previous : [];
    return incoming.map((item, index) => restoreMaskedSecrets(previousArray[index], item));
  }

  const previousRecord = isRecord(previous) ? previous : {};
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(incoming)) {
    if (isSecretKey(key) && val === '***') {
      if (key in previousRecord) {
        result[key] = previousRecord[key];
      }
    } else {
      result[key] = restoreMaskedSecrets(previousRecord[key], val);
    }
  }
  return result;
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  const patterns = ['apikey', 'token', 'secret', 'password', '密钥', '令牌', '密码'];
  return patterns.some((p) => lower.includes(p));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
