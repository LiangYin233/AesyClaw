/** 技能 API 路由 — 只读。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

export function createSkillsRouter(deps: WebUiManagerDependencies): Hono {
  const router = new Hono();

  router.get('/', (c) => {
    const skills = deps.skillManager.getAllSkills();
    const data = skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      isSystem: skill.isSystem,
    }));
    return c.json({ ok: true, data });
  });

  return router;
}
