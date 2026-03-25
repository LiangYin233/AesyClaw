import type { Express } from 'express';
import { asyncHandler } from '../../app/api/middleware/async-handler.js';
import { MemoryApiService } from './MemoryApiService.js';

export function registerMemoryController(app: Express, service: MemoryApiService): void {
  app.get('/api/memory', asyncHandler(async (_req, res) => {
    res.json(await service.listMemory());
  }));

  app.get('/api/memory/:key/history', asyncHandler(async (req, res) => {
    const rawKey = decodeURIComponent(String(req.params.key));
    res.json(await service.getHistory(rawKey));
  }));

  app.delete('/api/memory/:key', asyncHandler(async (req, res) => {
    const rawKey = decodeURIComponent(String(req.params.key));
    res.json(await service.deleteConversation(rawKey));
  }));

  app.delete('/api/memory', asyncHandler(async (_req, res) => {
    res.json(await service.deleteAll());
  }));
}
