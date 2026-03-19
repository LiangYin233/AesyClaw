import type { ToolDefinition } from '../types.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';

interface MCPToolSource {
  getToolsForServer(serverName: string): ToolDefinition[];
  callTool(name: string, args: Record<string, unknown>): Promise<string>;
}

function getToolPrefix(serverName: string): string {
  return `mcp_${serverName}_`;
}

export function clearMcpServerTools(toolRegistry: Pick<ToolRegistry, 'list' | 'unregisterMany'>, serverName: string): number {
  const prefix = getToolPrefix(serverName);
  const toolNames = toolRegistry
    .list()
    .filter((tool) => tool.name.startsWith(prefix))
    .map((tool) => tool.name);

  if (toolNames.length === 0) {
    return 0;
  }

  return toolRegistry.unregisterMany(toolNames);
}

export function syncMcpServerTools(
  toolRegistry: Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany'>,
  mcpManager: MCPToolSource,
  serverName: string
): number {
  clearMcpServerTools(toolRegistry, serverName);

  const tools = mcpManager.getToolsForServer(serverName);
  for (const tool of tools) {
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (params: Record<string, unknown>) => mcpManager.callTool(tool.name, params)
    }, 'mcp');
  }

  return tools.length;
}
