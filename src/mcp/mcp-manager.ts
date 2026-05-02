/** MCP 管理器 — 连接已配置的 MCP 服务器并暴露其工具。 */

import { Type, type TSchema } from '@sinclair/typebox';
import { createScopedLogger } from '../core/logger';
import { errorMessage, isRecord, requireInitialized } from '../core/utils';
import { SerialExecutor } from '../utils/serial-executor';
import type { McpServerConfig } from '../core/config/schema';
import type { ToolOwner } from '../core/types';
import type { ConfigManager } from '../core/config/config-manager';
import type { ToolRegistry, AesyClawTool, ToolExecutionResult } from '../tool/tool-registry';

const logger = createScopedLogger('mcp');

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export type McpClient = {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, params: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export type McpClientFactory = {
  create(config: McpServerConfig): McpClient;
}

export type McpManagerDependencies = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  clientFactory?: McpClientFactory;
}

export type ConnectedMcpServer = {
  name: string;
  config: McpServerConfig;
  client: McpClient;
  tools: string[];
  connectedAt: Date;
}

export type McpLifecycleState = 'connected' | 'disabled' | 'disconnected' | 'failed';

export type McpServerStatus = {
  name: string;
  enabled: boolean;
  state: McpLifecycleState;
  transport?: string;
  toolCount: number;
  error?: string;
}

type McpManagerStoredDeps = {
  configManager: ConfigManager;
  toolRegistry: ToolRegistry;
  clientFactory: McpClientFactory;
}

export class McpManager {
  private deps: McpManagerStoredDeps | null = null;
  private readonly connectedServers = new Map<string, ConnectedMcpServer>();
  private readonly failedServers = new Map<string, string>();
  private serialExecutor = new SerialExecutor();

  initialize(dependencies: McpManagerDependencies): void {
    if (this.deps) {
      logger.warn('McpManager 已初始化 — 跳过');
      return;
    }
    this.deps = {
      configManager: dependencies.configManager,
      toolRegistry: dependencies.toolRegistry,
      clientFactory: dependencies.clientFactory ?? new EmptyMcpClientFactory(),
    };
    logger.info('McpManager 已初始化');
  }

  destroy(): void {
    this.deps = null;
  }

  private requireDeps(): McpManagerStoredDeps {
    return requireInitialized(this.deps, 'McpManager');
  }

  async connectAll(): Promise<void> {
    this.requireDeps();
    for (const config of this.getConfigs()) {
      if (!config.enabled) {
        this.failedServers.delete(config.name);
        logger.info('跳过已禁用的 MCP 服务器', { server: config.name });
        continue;
      }

      try {
        await this.connect(config.name);
      } catch (err) {
        this.failedServers.set(config.name, errorMessage(err));
        logger.error(`MCP 服务器 "${config.name}" 连接失败`, err);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.connectedServers.keys()].reverse();
    for (const name of names) {
      try {
        await this.disconnect(name);
      } catch (err) {
        logger.error(`MCP 服务器 "${name}" 断开连接失败`, err);
      }
    }
    logger.info('所有 MCP 服务器已断开连接');
  }

  async connect(serverName: string): Promise<ConnectedMcpServer | null> {
    this.requireDeps();
    const config = this.getConfigs().find((entry) => entry.name === serverName);
    if (!config) {
      throw new Error(`MCP 服务器 "${serverName}" 未配置`);
    }
    if (!config.enabled) {
      logger.info('跳过已禁用的 MCP 服务器', { server: serverName });
      return null;
    }

    if (this.connectedServers.has(serverName)) {
      await this.disconnect(serverName);
    }

      const client = this.requireDeps().clientFactory.create(config);
      const owner: ToolOwner = mcpOwner(serverName);
      const toolRegistry = this.requireDeps().toolRegistry;
    try {
      await client.connect();
      const tools = await client.listTools();
      const registeredToolNames: string[] = [];
      const reservedNames = this.getReservedToolNames(serverName);
      for (const tool of tools) {
        const registeredName = uniqueMcpToolName(serverName, tool.name, reservedNames);
        reservedNames.add(registeredName);
        toolRegistry.register(this.createTool(owner, registeredName, tool, client));
        registeredToolNames.push(registeredName);
      }

      const connected: ConnectedMcpServer = {
        name: serverName,
        config: cloneConfig(config),
        client,
        tools: registeredToolNames,
        connectedAt: new Date(),
      };
      this.connectedServers.set(serverName, connected);
      this.failedServers.delete(serverName);
      logger.info('MCP 服务器已连接', {
        server: serverName,
        toolCount: registeredToolNames.length,
      });
      return connected;
    } catch (err) {
      toolRegistry.unregisterByOwner(owner);
      await closeQuietly(client, serverName);
      throw err;
    }
  }

  async disconnect(serverName: string): Promise<void> {
    const connected = this.connectedServers.get(serverName);
    const owner = mcpOwner(serverName);
    try {
      if (connected) {
        await connected.client.close();
      }
    } finally {
      this.requireDeps().toolRegistry.unregisterByOwner(owner);
      this.connectedServers.delete(serverName);
      this.failedServers.delete(serverName);
      logger.info('MCP 服务器已断开连接', { server: serverName });
    }
  }

  async handleConfigReload(): Promise<void> {
    return await this.serialExecutor.execute(async () => {
      await this.disconnectAll();
      await this.connectAll();
    }, 'MCP 配置重载');
  }

  listServers(): McpServerStatus[] {
    const statuses: McpServerStatus[] = [];
    for (const config of this.getConfigs()) {
      const connected = this.connectedServers.get(config.name);
      const error = this.failedServers.get(config.name);
      statuses.push({
        name: config.name,
        enabled: config.enabled,
        state: error
          ? 'failed'
          : connected
            ? 'connected'
            : config.enabled
              ? 'disconnected'
              : 'disabled',
        transport: config.transport,
        toolCount: connected?.tools.length ?? 0,
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  getConnected(serverName: string): ConnectedMcpServer | undefined {
    return this.connectedServers.get(serverName);
  }

  private createTool(
    owner: ToolOwner,
    registeredName: string,
    tool: McpToolDefinition,
    client: McpClient,
  ): AesyClawTool {
    return {
      name: registeredName,
      description: tool.description ?? `MCP 工具 ${tool.name}`,
      parameters: toToolSchema(tool.inputSchema),
      owner,
      execute: async (params: unknown): Promise<ToolExecutionResult> => {
        try {
          const result = await client.callTool(tool.name, params);
          return { content: formatMcpResult(result) };
        } catch (err) {
          return { content: errorMessage(err), isError: true };
        }
      },
    };
  }

  private getConfigs(): McpServerConfig[] {
    const configManager = this.requireDeps().configManager;
    try {
      return configManager.get('mcp').map(cloneConfig);
    } catch {
      return [];
    }
  }

  private getReservedToolNames(excludingServerName: string): Set<string> {
    const reservedNames = new Set<string>();
    for (const [serverName, connected] of this.connectedServers) {
      if (serverName === excludingServerName) {
        continue;
      }
      for (const toolName of connected.tools) {
        reservedNames.add(toolName);
      }
    }
    return reservedNames;
  }

}

export function mcpOwner(serverName: string): ToolOwner {
  return `mcp:${serverName}`;
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${sanitizeToolPart(serverName)}_${sanitizeToolPart(toolName)}`;
}

function uniqueMcpToolName(serverName: string, toolName: string, reservedNames: Set<string>): string {
  const baseName = mcpToolName(serverName, toolName);
  if (!reservedNames.has(baseName)) {
    return baseName;
  }

  let suffixIndex = 1;
  let candidate = `${baseName}_${shortHash(`${serverName}:${toolName}`)}`;
  while (reservedNames.has(candidate)) {
    suffixIndex += 1;
    candidate = `${baseName}_${shortHash(`${serverName}:${toolName}:${suffixIndex}`)}`;
  }
  return candidate;
}

function sanitizeToolPart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'unnamed';
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function cloneConfig(config: Readonly<McpServerConfig>): McpServerConfig {
  return {
    name: config.name,
    transport: config.transport,
    enabled: config.enabled,
    ...(config.command === undefined ? {} : { command: config.command }),
    ...(config.args === undefined ? {} : { args: [...config.args] }),
    ...(config.env === undefined ? {} : { env: { ...config.env } }),
    ...(config.url === undefined ? {} : { url: config.url }),
  };
}

function formatMcpResult(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (result === null || result === undefined) {
    return '';
  }
  return JSON.stringify(result);
}

function toToolSchema(inputSchema: unknown): TSchema {
  if (isMcpInputSchema(inputSchema)) {
    return Type.Unsafe(inputSchema);
  }
  return Type.Record(Type.String(), Type.Unknown());
}

function isMcpInputSchema(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === 'object';
}

async function closeQuietly(client: McpClient, serverName: string): Promise<void> {
  try {
    await client.close();
  } catch (err) {
    logger.warn(`连接错误后关闭 MCP 客户端失败: ${serverName}`, err);
  }
}

class EmptyMcpClient implements McpClient {
  async connect(): Promise<void> {
    logger.warn('EmptyMcpClient.connect() 被调用 — MCP 客户端工厂未配置，所有 MCP 操作为空操作');
  }
  async listTools(): Promise<McpToolDefinition[]> {
    return [];
  }
  async callTool(): Promise<unknown> {
    return '';
  }
  async close(): Promise<void> {}
}

class EmptyMcpClientFactory implements McpClientFactory {
  private warned = false;
  create(): McpClient {
    if (!this.warned) {
      this.warned = true;
      logger.warn('McpManager 未注入 clientFactory — 使用空客户端工厂；所有 MCP 连接/工具调用将被静默忽略');
    }
    return new EmptyMcpClient();
  }
}
