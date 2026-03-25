import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { PluginsService } from '../application/PluginsService.js';
import { parsePluginConfigUpdate, parseTogglePlugin } from './plugins.dto.js';

export function registerPluginsController(app: Express, service: PluginsService): void {
  app.get('/api/plugins', asyncHandler(async (_req, res) => {
    res.json(await service.listPlugins());
  }));

  app.post('/api/plugins/:name/toggle', asyncHandler(async (req, res) => {
    res.json(await service.togglePlugin(String(req.params.name), parseTogglePlugin(req.body).enabled));
  }));

  app.put('/api/plugins/:name/config', asyncHandler(async (req, res) => {
    res.json(await service.updatePluginConfig(String(req.params.name), parsePluginConfigUpdate(req.body).options));
  }));
}
