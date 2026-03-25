import type { Express } from 'express';
import { ValidationError } from '../../api/errors.js';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ConfigApiService } from './ConfigApiService.js';

export function registerConfigController(
  app: Express,
  service: ConfigApiService,
  log: { info(message: string, ...args: any[]): void }
): void {
  app.get('/api/config', (_req, res) => {
    res.json(service.getApiConfig());
  });

  app.put('/api/config', asyncHandler(async (req, res) => {
    const nextConfig = req.body;
    if (!nextConfig || typeof nextConfig !== 'object' || Array.isArray(nextConfig)) {
      throw new ValidationError('config body must be an object', 'config');
    }

    log.info('收到 API 配置更新请求', {
      request_id: req.requestId
    });

    res.json(await service.updateApiConfig(nextConfig as Record<string, unknown>));
  }));
}
