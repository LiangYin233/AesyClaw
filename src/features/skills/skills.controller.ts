import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { SkillApiService } from './SkillApiService.js';

export function registerSkillsController(app: Express, service: SkillApiService): void {
  app.get('/api/skills', (_req, res) => {
    res.json(service.listSkills());
  });

  app.get('/api/skills/:name', (req, res) => {
    res.json(service.getSkill(String(req.params.name)));
  });

  app.post('/api/skills/reload', asyncHandler(async (_req, res) => {
    res.json(await service.reload());
  }));

  app.post('/api/skills/:name/toggle', asyncHandler(async (req, res) => {
    res.json(await service.toggleSkill(String(req.params.name), req.body));
  }));
}
