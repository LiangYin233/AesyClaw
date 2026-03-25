import type { Express } from 'express';
import { SystemApiService } from './SystemApiService.js';

export function registerSystemController(app: Express, service: SystemApiService): void {
  app.get('/api/status', (_req, res) => {
    res.json(service.getStatus());
  });

  app.get('/api/tools', (_req, res) => {
    res.json(service.getTools());
  });
}
