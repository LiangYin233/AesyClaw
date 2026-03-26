import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { SkillsService } from '../application/SkillsService.js';
import { parseToggleSkill } from './skills.dto.js';

export function registerSkillsController(app: Express, service: SkillsService): void {
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
    res.json(await service.toggleSkill(String(req.params.name), parseToggleSkill(req.body).enabled));
  }));
}
