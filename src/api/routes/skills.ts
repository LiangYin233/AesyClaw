import type { Express } from 'express';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../errors/index.js';
import type { SkillManager } from '../../skills/SkillManager.js';

export function registerSkillRoutes(app: Express, skillManager?: SkillManager): void {
  if (!skillManager) {
    return;
  }

  app.get('/api/skills', (req, res) => {
    res.json({ skills: skillManager.listSkills() });
  });

  app.get('/api/skills/:name', (req, res) => {
    const skill = skillManager.getSkill(req.params.name);
    if (!skill) {
      return res.status(404).json(createErrorResponse(new NotFoundError('Skill', req.params.name)));
    }

    res.json({ skill });
  });

  app.post('/api/skills/reload', async (_req, res) => {
    try {
      const summary = await skillManager.reload();
      res.json({ success: true, summary });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/skills/:name/toggle', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json(createValidationErrorResponse('enabled must be a boolean', 'enabled'));
      }

      const success = await skillManager.toggleSkill(req.params.name, enabled);
      if (!success) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Skill', req.params.name)));
      }

      res.json({ success: true });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
