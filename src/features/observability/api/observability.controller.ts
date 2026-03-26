import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { ObservabilityService } from '../application/ObservabilityService.js';
import { parseLoggingEntriesQuery, parseLoggingLevelUpdate } from './observability.dto.js';

export function registerObservabilityController(app: Express, service: ObservabilityService): void {
  app.get('/api/observability/logging/config', (_req, res) => {
    res.json(service.getLoggingConfig());
  });

  app.get('/api/observability/logging/entries', asyncHandler(async (req, res) => {
    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const levelParam = Array.isArray(req.query.level) ? req.query.level[0] : req.query.level;
    res.json(service.getLoggingEntries(parseLoggingEntriesQuery({ limit: limitParam, level: levelParam })));
  }));

  app.post('/api/observability/logging/level', asyncHandler(async (req, res) => {
    res.json(await service.updateLoggingLevel(parseLoggingLevelUpdate(req.body).level));
  }));

  app.get('/api/observability/usage', (_req, res) => {
    res.json(service.getUsage());
  });

  app.post('/api/observability/usage/reset', (_req, res) => {
    res.json(service.resetUsage());
  });
}
