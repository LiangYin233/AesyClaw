import type { Config } from '../../../types.js';
import { registerMcpTools } from '../../../platform/tools/index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import { McpClientManager } from '../infrastructure/McpClientManager.js';
import { clearMcpServerTools, syncMcpServerTools } from './syncMcpServerTools.js';
import { logger } from '../../../platform/observability/index.js';

const log = logger.child('MCP');

type ToolRegistryView = Pick<ToolRegistry, 'register' | 'list' | 'unregisterMany' | 'getSource'>;

export interface McpRuntimeBinding {
  getMcpManager(): McpClientManager | undefined;
  setMcpManager(manager: McpClientManager | undefined): void;
  toolRegistry?: ToolRegistryView;
}

function hasEnabledMcpServer(config: Config): boolean {
  return Object.values(config.mcp).some((server) => server.enabled !== false);
}

function serializeServerConfig(config: Config['mcp'][string]): string {
  return JSON.stringify(config);
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
  if (!config.mcp || Object.keys(config.mcp).length === 0 || !hasEnabledMcpServer(config)) {
    return null;
  }

  const manager = ensureMcpManager(binding);
  const enabledServers = Object.entries(config.mcp)
    .filter(([, server]) => server.enabled !== false)
    .map(([name]) => name);
  manager.connectAsync(config.mcp);
  log.info('MCP 服务器已连接', { servers: enabledServers });
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
  const enabledServerEntries = Object.entries(config.mcp).filter(([, serverConfig]) => serverConfig.enabled !== false);
  const enabledServerNames = new Set(enabledServerEntries.map(([name]) => name));
  const manager = enabledServerEntries.length > 0
    ? ensureMcpManager(binding)
    : binding.getMcpManager();
  const currentStatuses = manager?.getServerStatus();
  const statusList = Array.isArray(currentStatuses) ? currentStatuses : [];
  const currentStatusByName = new Map(statusList.map((server) => [server.name, server]));
  const currentNames = new Set(
    statusList.map((server) => server.name)
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

    const currentStatus = currentStatusByName.get(name);
    const configChanged = !currentStatus || serializeServerConfig(currentStatus.config) !== serializeServerConfig(serverConfig);
    const needsReconnect = !currentStatus || currentStatus.status !== 'connected' || configChanged;

    if (!needsReconnect) {
      continue;
    }

    await connectMcpServer(binding, name, serverConfig);
  }

  if (enabledServerNames.size === 0 && manager) {
    await manager.close();
    binding.setMcpManager(undefined);
  }
}
