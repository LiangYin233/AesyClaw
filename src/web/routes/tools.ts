/** 工具 API 路由 — 只读。 */

import { Hono } from 'hono';
import type { WebUiManagerDependencies } from '../webui-manager';

export function createToolsRouter(deps: WebUiManagerDependencies) {
  const router = new Hono();

  router.get('/', (c) => {
    const tools = deps.toolRegistry.getAll();
    const data = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      owner: tool.owner,
      parameters: JSON.parse(JSON.stringify(tool.parameters)),
    }));
    return c.json({ ok: true, data });
  });

  return router;
}
