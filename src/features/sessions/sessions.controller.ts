import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { SessionApiService } from './SessionApiService.js';

export function registerSessionsController(app: Express, service: SessionApiService): void {
  app.get('/api/sessions', asyncHandler(async (_req, res) => {
    res.json({ sessions: await service.listSessions() });
  }));

  app.get('/api/sessions/:key', asyncHandler(async (req, res) => {
    res.json(await service.getSessionDetails(String(req.params.key)));
  }));

  app.delete('/api/sessions/:key', asyncHandler(async (req, res) => {
    res.json(await service.deleteSession(String(req.params.key)));
  }));
}
