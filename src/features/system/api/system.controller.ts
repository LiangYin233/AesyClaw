import type { Express } from 'express';
import { SystemService } from '../application/SystemService.js';

export function registerSystemController(app: Express, service: SystemService): void {
  app.get('/api/status', (_req, res) => {
    res.json(service.getStatus());
  });

  app.get('/api/tools', (_req, res) => {
    res.json(service.getTools());
  });
}
