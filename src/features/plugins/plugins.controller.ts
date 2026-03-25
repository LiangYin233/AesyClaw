import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { PluginApiService } from './PluginApiService.js';

export function registerPluginsController(app: Express, service: PluginApiService): void {
  app.get('/api/plugins', asyncHandler(async (_req, res) => {
    res.json(await service.listPlugins());
  }));

  app.post('/api/plugins/:name/toggle', asyncHandler(async (req, res) => {
    res.json(await service.togglePlugin(String(req.params.name), req.body));
  }));

  app.put('/api/plugins/:name/config', asyncHandler(async (req, res) => {
    res.json(await service.updatePluginConfig(String(req.params.name), req.body));
  }));
}
