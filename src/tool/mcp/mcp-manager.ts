/** MCP 管理器 — 连接已配置的 MCP 服务器并暴露其工具。 */

import { Type, type TSchema } from '@sinclair/typebox';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage, isRecord } from '@aesyclaw/core/utils';
import type { McpServerConfig } from '@aesyclaw/core/config/schema';
import type { ToolOwner } from '@aesyclaw/core/types';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type {
  ToolRegistry,
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';

const logger = createScopedLogger('mcp');

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type McpClient = {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, params: unknown): Promise<unknown>;
  close(): Promise<void>;
};

export type McpClientFactory = {
  create(config: McpServerConfig): McpClient;
};

export type ConnectedMcpServer = {
  name: string;
  config: McpServerConfig;
  client: McpClient;
  tools: string[];
  connectedAt: Date;
};

export type McpLifecycleState = 'connected' | 'disabled' | 'disconnected' | 'failed';

export type McpServerStatus = {
  name: string;
  enabled: boolean;
  state: McpLifecycleState;
  transport?: string;
  toolCount: number;
  error?: string;
};

export class McpManager {
  private readonly connectedServers = new Map<string, ConnectedMcpServer>();
  private readonly failedServers = new Map<string, string>();

  constructor(
    private configManager: ConfigManager,
    private toolRegistry: ToolRegistry,
    private clientFactory: McpClientFactory,
  ) {}

  async connectAll(): Promise<void> {
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

    const client = this.clientFactory.create(config);
    const owner: ToolOwner = `mcp:${serverName}`;
    const toolRegistry = this.toolRegistry;
    try {
      await client.connect();
      const tools = await client.listTools();
      const registeredToolNames: string[] = [];
      for (const tool of tools) {
        const baseName = mcpToolName(serverName, tool.name);
        const registeredName = toolRegistry.registerUnique(baseName, (name) =>
          this.createTool(owner, name, tool, client),
        );
        registeredToolNames.push(registeredName);
      }

      const connected: ConnectedMcpServer = {
        name: serverName,
        config: structuredClone(config),
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
      try {
        await client.close();
      } catch (err) {
        logger.warn(`连接错误后关闭 MCP 客户端失败: ${serverName}`, err);
      }
      throw err;
    }
  }

  async disconnect(serverName: string): Promise<void> {
    const connected = this.connectedServers.get(serverName);
    const owner: ToolOwner = `mcp:${serverName}`;
    try {
      if (connected) {
        await connected.client.close();
      }
    } finally {
      this.toolRegistry.unregisterByOwner(owner);
      this.connectedServers.delete(serverName);
      this.failedServers.delete(serverName);
      logger.info('MCP 服务器已断开连接', { server: serverName });
    }
  }

  async handleConfigReload(): Promise<void> {
    await this.disconnectAll();
    await this.connectAll();
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
          : connected !== undefined
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
      execute: async (
        params: unknown,
        _context: ToolExecutionContext,
      ): Promise<ToolExecutionResult> => {
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
    try {
      return (this.configManager.get('mcp') as McpServerConfig[]).map((c) => structuredClone(c));
    } catch {
      return [];
    }
  }
}
export function mcpToolName(serverName: string, toolName: string): string {
  const safe = (v: string): string => v.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unnamed';
  return `${safe(serverName)}_${safe(toolName)}`;
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
  if (isRecord(inputSchema) && inputSchema['type'] === 'object') {
    return Type.Unsafe(inputSchema);
  }
  return Type.Record(Type.String(), Type.Unknown());
}
