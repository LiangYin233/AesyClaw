import type { Express } from 'express';
import type { SkillManager } from '../../skills/SkillManager.js';
import { badRequest, notFound, serverError } from './helpers.js';

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
      return notFound(res, 'Skill', req.params.name);
    }

    res.json({ skill });
  });

  app.post('/api/skills/reload', async (_req, res) => {
    try {
      const summary = await skillManager.reload();
      res.json({ success: true, summary });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });

  app.post('/api/skills/:name/toggle', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return badRequest(res, 'enabled must be a boolean', 'enabled');
      }

      const skill = skillManager.getSkill(req.params.name);
      if (!skill) {
        return notFound(res, 'Skill', req.params.name);
      }
      if (!skill.configurable) {
        return badRequest(res, 'built-in skill cannot be toggled', 'name');
      }

      const success = await skillManager.toggleSkill(req.params.name, enabled);
      if (!success) {
        return notFound(res, 'Skill', req.params.name);
      }

      res.json({ success: true });
    } catch (error: unknown) {
      serverError(res, error);
    }
  });
}
