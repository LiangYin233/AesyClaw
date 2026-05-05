/** 工具 Service — 只读。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';

/**
 * 获取所有已注册工具。
 */
export function getTools(
  deps: WebUiManagerDependencies,
): Array<{ name: string; description: string; owner: string; parameters: unknown }> {
  const tools = deps.toolRegistry.getAll();
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    owner: tool.owner,
    parameters: JSON.parse(JSON.stringify(tool.parameters)),
  }));
}
