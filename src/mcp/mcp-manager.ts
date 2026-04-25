/** MCP manager — connects configured MCP servers and exposes their tools. */

import { Type, type TSchema } from '@sinclair/typebox';
import { createScopedLogger } from '../core/logger';
import type { McpServerConfig } from '../core/config/schema';
import type { DeepPartial, ToolOwner } from '../core/types';
import type { AesyClawTool, ToolExecutionResult } from '../tool/tool-registry';
import type { AppConfig } from '../core/config/schema';

const logger = createScopedLogger('mcp');

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpClient {
  connect(): Promise<void>;
  listTools(): Promise<McpToolDefinition[]>;
  callTool(name: string, params: unknown): Promise<unknown>;
  close(): Promise<void>;
}

export interface McpClientFactory {
  create(config: McpServerConfig): McpClient;
}

export interface McpConfigManagerLike {
  get(key: 'mcp'): ReadonlyArray<Readonly<McpServerConfig>>;
  update?(partial: DeepPartial<Pick<AppConfig, 'mcp'>>): Promise<void>;
}

export interface McpManagerDependencies {
  configManager: McpConfigManagerLike;
  toolRegistry: McpToolRegistryLike;
  clientFactory?: McpClientFactory;
}

export interface McpToolRegistryLike {
  register(tool: AesyClawTool): void;
  unregisterByOwner(owner: ToolOwner): void;
}

export interface ConnectedMcpServer {
  name: string;
  config: McpServerConfig;
  client: McpClient;
  tools: string[];
  connectedAt: Date;
}

export type McpLifecycleState = 'connected' | 'disabled' | 'disconnected' | 'failed';

export interface McpServerStatus {
  name: string;
  enabled: boolean;
  state: McpLifecycleState;
  transport?: string;
  toolCount: number;
  error?: string;
}

export class McpManager {
  private configManager: McpConfigManagerLike | null = null;
  private toolRegistry: McpToolRegistryLike | null = null;
  private clientFactory: McpClientFactory = new EmptyMcpClientFactory();
  private readonly connectedServers = new Map<string, ConnectedMcpServer>();
  private readonly failedServers = new Map<string, string>();
  private initialized = false;
  private reloading = false;

  initialize(dependencies: McpManagerDependencies): void {
    if (this.initialized) {
      logger.warn('McpManager already initialized — skipping');
      return;
    }

    this.configManager = dependencies.configManager;
    this.toolRegistry = dependencies.toolRegistry;
    this.clientFactory = dependencies.clientFactory ?? new EmptyMcpClientFactory();
    this.initialized = true;
    logger.info('McpManager initialized');
  }

  async connectAll(): Promise<void> {
    this.assertInitialized();
    for (const config of this.getConfigs()) {
      if (!config.enabled) {
        this.failedServers.delete(config.name);
        logger.info('Skipping disabled MCP server', { server: config.name });
        continue;
      }

      try {
        await this.connect(config.name);
      } catch (err) {
        this.failedServers.set(config.name, errorMessage(err));
        logger.error(`MCP server "${config.name}" failed to connect`, err);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const names = [...this.connectedServers.keys()].reverse();
    for (const name of names) {
      try {
        await this.disconnect(name);
      } catch (err) {
        logger.error(`MCP server "${name}" failed to disconnect`, err);
      }
    }
    logger.info('All MCP servers disconnected');
  }

  async connect(serverName: string): Promise<ConnectedMcpServer> {
    this.assertInitialized();
    const config = this.getConfigs().find((entry) => entry.name === serverName);
    if (!config) {
      throw new Error(`MCP server "${serverName}" is not configured`);
    }
    if (!config.enabled) {
      return this.createDisconnectedServer(config);
    }

    if (this.connectedServers.has(serverName)) {
      await this.disconnect(serverName);
    }

    const client = this.clientFactory.create(config);
    const owner: ToolOwner = mcpOwner(serverName);
    const toolRegistry = this.getToolRegistry();
    try {
      await client.connect();
      const tools = await client.listTools();
      const registeredToolNames: string[] = [];
      for (const tool of tools) {
        const registeredName = mcpToolName(serverName, tool.name);
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
      logger.info('MCP server connected', {
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
      this.toolRegistry?.unregisterByOwner(owner);
      this.connectedServers.delete(serverName);
      this.failedServers.delete(serverName);
      logger.info('MCP server disconnected', { server: serverName });
    }
  }

  async handleConfigReload(): Promise<void> {
    if (this.reloading) {
      logger.debug('MCP config reload already in progress — skipping');
      return;
    }

    this.reloading = true;
    try {
      await this.disconnectAll();
      await this.connectAll();
    } finally {
      this.reloading = false;
    }
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
      description: tool.description ?? `MCP tool ${tool.name}`,
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
    if (!this.configManager) {
      return [];
    }
    try {
      return this.configManager.get('mcp').map(cloneConfig);
    } catch {
      return [];
    }
  }

  private createDisconnectedServer(config: McpServerConfig): ConnectedMcpServer {
    return {
      name: config.name,
      config: cloneConfig(config),
      client: new EmptyMcpClient(),
      tools: [],
      connectedAt: new Date(),
    };
  }

  private assertInitialized(): void {
    if (!this.initialized || !this.configManager || !this.toolRegistry) {
      throw new Error('McpManager not initialized');
    }
  }

  private getToolRegistry(): McpToolRegistryLike {
    this.assertInitialized();
    if (!this.toolRegistry) {
      throw new Error('McpManager not initialized');
    }
    return this.toolRegistry;
  }
}

export function mcpOwner(serverName: string): ToolOwner {
  return `mcp:${serverName}`;
}

export function mcpToolName(serverName: string, toolName: string): string {
  return `${sanitizeToolPart(serverName)}_${sanitizeToolPart(toolName)}`;
}

function sanitizeToolPart(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  return sanitized.length > 0 ? sanitized : 'unnamed';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function closeQuietly(client: McpClient, serverName: string): Promise<void> {
  try {
    await client.close();
  } catch (err) {
    logger.warn(`Failed to close MCP client after connection error: ${serverName}`, err);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class EmptyMcpClient implements McpClient {
  async connect(): Promise<void> {}
  async listTools(): Promise<McpToolDefinition[]> {
    return [];
  }
  async callTool(): Promise<unknown> {
    return '';
  }
  async close(): Promise<void> {}
}

class EmptyMcpClientFactory implements McpClientFactory {
  create(): McpClient {
    return new EmptyMcpClient();
  }
}
