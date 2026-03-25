import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ConfigApiService } from './ConfigApiService.js';
import { parseConfigUpdate } from './config.dto.js';

export function registerConfigController(
  app: Express,
  service: ConfigApiService,
  log: { info(message: string, ...args: any[]): void }
): void {
  app.get('/api/config', (_req, res) => {
    res.json(service.getApiConfig());
  });

  app.put('/api/config', asyncHandler(async (req, res) => {
    log.info('收到 API 配置更新请求', {
      request_id: req.requestId
    });

    res.json(await service.updateApiConfig(parseConfigUpdate(req.body)));
  }));
}
