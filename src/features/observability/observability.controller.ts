import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ObservabilityApiService } from './ObservabilityApiService.js';

export function registerObservabilityController(app: Express, service: ObservabilityApiService): void {
  app.get('/api/observability/logging/config', (_req, res) => {
    res.json(service.getLoggingConfig());
  });

  app.get('/api/observability/logging/entries', asyncHandler(async (req, res) => {
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const levelParam = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
    res.json(service.getLoggingEntries({ limit: limitParam, level: levelParam }));
  }));

  app.post('/api/observability/logging/level', asyncHandler(async (req, res) => {
    res.json(await service.updateLoggingLevel(req.body));
  }));

  app.get('/api/observability/usage', (_req, res) => {
    res.json(service.getUsage());
  });

  app.post('/api/observability/usage/reset', (_req, res) => {
    res.json(service.resetUsage());
  });
}
