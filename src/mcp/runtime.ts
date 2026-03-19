import type { Config } from '../types.js';
import { logger } from '../observability/index.js';
import { MCPClientManager } from './MCPClient.js';
import { registerMcpTools } from '../tools/index.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { clearMcpServerTools, syncMcpServerTools } from './toolSync.js';

const log = logger.child('MCPRuntime');

type ToolRegistryView = Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany'>;

export interface MCPRuntimeBinding {
  getMcpManager(): MCPClientManager | undefined;
  setMcpManager(manager: MCPClientManager): void;
  toolRegistry?: ToolRegistryView;
}

function hasEnabledMcpServer(config: Config): boolean {
  return Object.values(config.mcp).some((server) => server.enabled !== false);
}

export function ensureMcpManager(binding: MCPRuntimeBinding): MCPClientManager {
  const existing = binding.getMcpManager();
  if (existing) {
    return existing;
  }

  const manager = new MCPClientManager();
  if (binding.toolRegistry) {
    registerMcpTools(binding.toolRegistry as ToolRegistry, manager);
  }
  binding.setMcpManager(manager);
  return manager;
}

export function startConfiguredMcpServers(binding: MCPRuntimeBinding, config: Config): MCPClientManager | null {
  if (!config.mcp || Object.keys(config.mcp).length === 0) {
    return null;
  }

  const manager = ensureMcpManager(binding);
  manager.connectAsync(config.mcp);
  log.info('MCP 服务器正在后台连接');
  return manager;
}

export async function connectMcpServer(
  binding: MCPRuntimeBinding,
  serverName: string,
  serverConfig: Config['mcp'][string]
): Promise<{ manager: MCPClientManager; toolsRegistered: number }> {
  const manager = ensureMcpManager(binding);
  await manager.connectOne(serverName, serverConfig);

  return {
    manager,
    toolsRegistered: binding.toolRegistry
      ? syncMcpServerTools(binding.toolRegistry, manager, serverName)
      : 0
  };
}

export async function disconnectMcpServer(
  binding: MCPRuntimeBinding,
  serverName: string
): Promise<{ manager: MCPClientManager | undefined; toolsRemoved: number }> {
  const manager = binding.getMcpManager();
  if (manager) {
    await manager.disconnectOne(serverName);
  }

  return {
    manager,
    toolsRemoved: binding.toolRegistry
      ? clearMcpServerTools(binding.toolRegistry, serverName)
      : 0
  };
}

export async function reconnectMcpServer(
  binding: MCPRuntimeBinding,
  serverName: string
): Promise<{ manager: MCPClientManager; toolsRegistered: number }> {
  const manager = ensureMcpManager(binding);
  await manager.reconnect(serverName);

  return {
    manager,
    toolsRegistered: binding.toolRegistry
      ? syncMcpServerTools(binding.toolRegistry, manager, serverName)
      : 0
  };
}

export async function syncConfiguredMcpServers(binding: MCPRuntimeBinding, config: Config): Promise<void> {
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
