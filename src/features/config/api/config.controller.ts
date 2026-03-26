import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { ConfigService } from '../application/ConfigService.js';
import { parseConfigUpdate } from './config.dto.js';

export function registerConfigController(
  app: Express,
  service: ConfigService,
  _log: { info(message: string, ...args: any[]): void }
): void {
  app.get('/api/config', (_req, res) => {
    res.json(service.getApiConfig());
  });

  app.put('/api/config', asyncHandler(async (req, res) => {

    res.json(await service.updateApiConfig(parseConfigUpdate(req.body)));
  }));
}
