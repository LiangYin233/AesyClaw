import type { Config } from '../../../types.js';
import { logger } from '../../../platform/observability/index.js';
import { registerMcpTools } from '../../../platform/tools/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import { McpClientManager } from '../infrastructure/McpClientManager.js';
import { clearMcpServerTools, syncMcpServerTools } from './syncMcpServerTools.js';

const log = logger.child('MCPRuntime');

type ToolRegistryView = Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany' | 'getSource'>;

export interface McpRuntimeBinding {
  getMcpManager(): McpClientManager | undefined;
  setMcpManager(manager: McpClientManager): void;
  toolRegistry?: ToolRegistryView;
}

function hasEnabledMcpServer(config: Config): boolean {
  return Object.values(config.mcp).some((server) => server.enabled !== false);
}

export function ensureMcpManager(binding: McpRuntimeBinding): McpClientManager {
  const existing = binding.getMcpManager();
  if (existing) {
    return existing;
  }

  const manager = new McpClientManager();
  if (binding.toolRegistry) {
    registerMcpTools(binding.toolRegistry as ToolRegistry, manager);
  }
  binding.setMcpManager(manager);
  return manager;
}

export function startConfiguredMcpServers(binding: McpRuntimeBinding, config: Config): McpClientManager | null {
  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    return null;
  }

  const manager = ensureMcpManager(binding);
  manager.connectAsync(config.mcp);
  log.info('MCP 服务器正在后台连接');
  return manager;
}

export async function connectMcpServer(
  binding: McpRuntimeBinding,
  serverName: string,
  serverConfig: Config['mcp'][string]
): Promise<{ manager: McpClientManager; toolsRegistered: number }> {
  const manager = ensureMcpManager(binding);
  if (binding.toolRegistry) {
    clearMcpServerTools(binding.toolRegistry, manager, serverName);
  }
  await manager.connectOne(serverName, serverConfig);

  return {
    manager,
    toolsRegistered: binding.toolRegistry
      ? syncMcpServerTools(binding.toolRegistry, manager, serverName)
      : 0
  };
}

export async function disconnectMcpServer(
  binding: McpRuntimeBinding,
  serverName: string
): Promise<{ manager: McpClientManager | undefined; toolsRemoved: number }> {
  const manager = binding.getMcpManager();
  const toolsRemoved = manager && binding.toolRegistry
    ? clearMcpServerTools(binding.toolRegistry, manager, serverName)
    : 0;
  if (manager) {
    await manager.disconnectOne(serverName);
  }

  return {
    manager,
    toolsRemoved
  };
}

export async function reconnectMcpServer(
  binding: McpRuntimeBinding,
  serverName: string
): Promise<{ manager: McpClientManager; toolsRegistered: number }> {
  const manager = ensureMcpManager(binding);
  if (binding.toolRegistry) {
    clearMcpServerTools(binding.toolRegistry, manager, serverName);
  }
  await manager.reconnect(serverName);

  return {
    manager,
    toolsRegistered: binding.toolRegistry
      ? syncMcpServerTools(binding.toolRegistry, manager, serverName)
      : 0
  };
}

export async function syncConfiguredMcpServers(binding: McpRuntimeBinding, config: Config): Promise<void> {
  const manager = hasEnabledMcpServer(config)
    ? ensureMcpManager(binding)
    : binding.getMcpManager();
  const currentStatuses = manager?.getServerStatus();
  const currentNames = new Set(
    Array.isArray(currentStatuses)
      ? currentStatuses.map((server) => server.name)
      : []
  );

  for (const name of currentNames) {
    if (config.mcp[name]) {
      continue;
    }

    await disconnectMcpServer(binding, name);
  }

  for (const [name, serverConfig] of Object.entries(config.mcp)) {
    if (serverConfig.enabled === false) {
      await disconnectMcpServer(binding, name);
      continue;
    }

    await connectMcpServer(binding, name, serverConfig);
  }
}
