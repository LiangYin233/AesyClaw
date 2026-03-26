import type { ToolDefinition } from '../../../types.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';

interface McpToolSource {
  getToolsForServer(serverName: string): ToolDefinition[];
  getRegisteredToolNamesForServer(serverName: string): string[];
  getRegisteredServerForTool(toolName: string): string | undefined;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
}

type ToolRegistryView = Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany' | 'getSource'>;

function describeConflictSource(
  toolRegistry: Pick<ToolRegistry, 'getSource'>,
  mcpManager: McpToolSource,
  toolName: string
): string {
  const source = toolRegistry.getSource(toolName);
  if (!source) {
    return 'unknown';
  }

  if (source.source !== 'mcp') {
    return source.source;
  }

  const owner = mcpManager.getRegisteredServerForTool(toolName);
  return owner ? `mcp:${owner}` : 'mcp';
}

export function clearMcpServerTools(
  toolRegistry: Pick<ToolRegistry, 'unregisterMany'>,
  mcpManager: McpToolSource,
  serverName: string
): number {
  const toolNames = mcpManager.getRegisteredToolNamesForServer(serverName);

  if (toolNames.length === 0) {
    return 0;
  }

  return toolRegistry.unregisterMany(toolNames);
}

export function syncMcpServerTools(
  toolRegistry: ToolRegistryView,
  mcpManager: McpToolSource,
  serverName: string
): number {
  const tools = mcpManager.getToolsForServer(serverName);
  const currentToolNames = new Set(mcpManager.getRegisteredToolNamesForServer(serverName));
  const existingToolNames = new Set(toolRegistry.list().map((tool) => tool.name));
  const conflicts: string[] = [];

  for (const tool of tools) {
    if (!existingToolNames.has(tool.name) || currentToolNames.has(tool.name)) {
      continue;
    }

    conflicts.push(`${tool.name} (${describeConflictSource(toolRegistry, mcpManager, tool.name)})`);
  }

  if (conflicts.length > 0) {
    throw new Error(`MCP server ${serverName} tool registration conflicts: ${conflicts.join(', ')}`);
  }

  clearMcpServerTools(toolRegistry, mcpManager, serverName);

  for (const tool of tools) {
    toolRegistry.register({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (params: Record<string, unknown>, context) => mcpManager.callTool(tool.name, params, context?.signal)
    }, 'mcp');
  }

  return tools.length;
}
