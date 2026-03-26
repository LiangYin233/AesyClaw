import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ToolDefinition, MCPServersConfig, MCPServerConfig, MCPServerInfo } from '../../../types.js';
import { logger } from '../../../platform/observability/index.js';

const DEFAULT_MCP_TIMEOUT = 120000;
type McpToolLoadCallback = (serverName: string, tools: ToolDefinition[]) => void | Promise<void>;

export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private serverTools: Map<string, Map<string, ToolDefinition>> = new Map();
  private registeredTools: Map<string, ToolDefinition> = new Map();
  private registeredToolOwners: Map<string, string> = new Map();
  private registeredServerTools: Map<string, Set<string>> = new Map();
  private serverStatus: Map<string, MCPServerInfo> = new Map();
  private toolLoadCallbacks: McpToolLoadCallback[] = [];
  private log = logger.child('MCP');
  private static readonly DEFAULT_TIMEOUT = DEFAULT_MCP_TIMEOUT;

  private createAbortError(reason: unknown): Error {
    if (reason instanceof Error) {
      return reason;
    }

    const error = new Error(typeof reason === 'string' ? reason : 'MCP tool call aborted');
    error.name = 'AbortError';
    return error;
  }

  async connectAsync(config: MCPServersConfig): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(config)) {
      if (serverConfig.enabled === false) {
        this.log.debug('跳过已禁用的 MCP 服务器', { server: name });
        continue;
      }

      const promise = this.connectOne(name, serverConfig).catch((error) => {
        this.log.error(`MCP 服务器连接失败: ${name}`, { error });
      });
      promises.push(promise);
    }

    Promise.all(promises)
      .then(() => {
        this.log.info('所有 MCP 服务器连接完成');
      })
      .catch((error) => {
        this.log.error('MCP 服务器连接流程失败', { error });
      });
  }

  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const timeout = config.timeout ?? McpClientManager.DEFAULT_TIMEOUT;
    const transportType = config.type || 'local';

    const client = new Client({
      name: `aesyclaw-${name}`,
      version: '0.1.0'
    }, {
      capabilities: {}
    });

    let transport: StdioClientTransport | SSEClientTransport;

    if (transportType === 'local') {
      let command = config.command;
      if (typeof command === 'string') {
        try {
          command = JSON.parse(command);
        } catch {
          throw new Error(`MCP server ${name}: command must be an array or valid JSON array string`);
        }
      }
      if (!command || !Array.isArray(command) || command.length === 0) {
        throw new Error(`MCP server ${name}: command is required for local type`);
      }

      const env: Record<string, string> = { ...process.env } as Record<string, string>;
      if (config.environment) {
        for (const [key, val] of Object.entries(config.environment)) {
          if (val !== undefined) {
            env[key] = val;
          }
        }
      }

      transport = new StdioClientTransport({
        command: command[0],
        args: command.slice(1),
        env
      });
      this.log.info('正在连接 MCP 服务器', { server: name, transport: 'stdio' });
    } else if (transportType === 'http') {
      if (!config.url) {
        throw new Error(`MCP server ${name}: url is required for http type`);
      }

      if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
        throw new Error(`MCP server ${name}: url must start with http:// or https://`);
      }

      const sseOptions: Record<string, unknown> = {};
      if (config.headers) {
        sseOptions.headers = config.headers;
      }

      transport = new SSEClientTransport(new URL(config.url), sseOptions);
      this.log.info('正在连接 MCP 服务器', { server: name, transport: 'sse' });
    } else {
      throw new Error(`MCP server ${name}: invalid transport type ${transportType}`);
    }

    try {
      await Promise.race([
        (async () => {
          await client.connect(transport as never);
          this.clients.set(name, client);
          await this.loadTools(client, name);
          this.log.debug('MCP transport connected', { server: name });
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`MCP server ${name} connection timeout after ${timeout}ms`)), timeout)
        )
      ]);
    } catch (error) {
      await client.close().catch(() => {});
      this.clients.delete(name);
      throw new Error(`Failed to connect to MCP server ${name}`, { cause: error });
    }
  }

  private async loadTools(client: Client, serverName: string): Promise<void> {
    const response = await client.listTools();
    const tools = new Map<string, ToolDefinition>();
    const duplicateNames = new Set<string>();

    for (const tool of response.tools || []) {
      if (tools.has(tool.name)) {
        duplicateNames.add(tool.name);
        continue;
      }

      tools.set(tool.name, {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema
      });
    }

    if (duplicateNames.size > 0) {
      throw new Error(`MCP server ${serverName} returned duplicate tool names: ${Array.from(duplicateNames).join(', ')}`);
    }

    this.serverTools.set(serverName, tools);
    this.log.info('MCP 工具已加载', { server: serverName, toolCount: tools.size });
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, timeout?: number): Promise<string> {
    const serverName = this.registeredToolOwners.get(name);
    if (!serverName) {
      throw new Error(`MCP tool not registered: ${name}`);
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const requestTimeout = timeout ?? McpClientManager.DEFAULT_TIMEOUT;

    this.log.debug('MCP tool started', { server: serverName, toolName: name, argKeys: Object.keys(args || {}) });

    let parsedArgs = args;
    if (typeof args === 'string') {
      try {
        parsedArgs = JSON.parse(args);
      } catch (error) {
        throw new Error('Invalid arguments format: expected object, got string that cannot be parsed as JSON', { cause: error });
      }
    }

    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
      throw new Error(`Invalid arguments: expected object, got ${typeof parsedArgs}`);
    }

    let timeoutId: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      if (!signal) {
        return;
      }

      const onAbort = () => reject(this.createAbortError(signal.reason));
      if (signal.aborted) {
        onAbort();
        return;
      }

      abortListener = onAbort;
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const response = await Promise.race<any>([
      client.callTool(
        { name, arguments: parsedArgs }
      ),
      abortPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`MCP tool call timeout after ${requestTimeout}ms`)), requestTimeout);
      })
    ]).finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (signal && abortListener) {
        signal.removeEventListener('abort', abortListener);
      }
    });

    this.log.debug('MCP tool completed', { server: serverName, toolName: name, contentItems: response?.content?.length || 0 });

    const textParts = (response?.content || [])
      .filter((item: any) => item?.type === 'text' && typeof item?.text === 'string')
      .map((item: any) => item.text);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }

    if (response?.structuredContent !== undefined) {
      return typeof response.structuredContent === 'string'
        ? response.structuredContent
        : JSON.stringify(response.structuredContent);
    }

    return response?.content?.length ? JSON.stringify(response.content) : '';
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.registeredTools.values());
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  onToolsLoaded(callback: McpToolLoadCallback): void {
    this.toolLoadCallbacks.push(callback);
  }

  private async notifyToolsLoaded(serverName: string, tools: ToolDefinition[]): Promise<void> {
    for (const callback of this.toolLoadCallbacks) {
      await callback(serverName, tools);
    }
  }

  getServerStatus(name?: string): MCPServerInfo | MCPServerInfo[] {
    if (name) {
      return this.serverStatus.get(name) || {
        name,
        status: 'disconnected',
        config: {} as MCPServerConfig,
        toolCount: 0
      };
    }
    return Array.from(this.serverStatus.values());
  }

  private getServerToolCount(serverName: string): number {
    return this.registeredServerTools.get(serverName)?.size || 0;
  }

  private getServerTools(serverName: string): ToolDefinition[] {
    return Array.from(this.serverTools.get(serverName)?.values() || []);
  }

  getToolsForServer(serverName: string): ToolDefinition[] {
    return this.getServerTools(serverName);
  }

  getRegisteredToolNamesForServer(serverName: string): string[] {
    return Array.from(this.registeredServerTools.get(serverName) || []);
  }

  getRegisteredServerForTool(toolName: string): string | undefined {
    return this.registeredToolOwners.get(toolName);
  }

  private markServerToolsRegistered(serverName: string): void {
    const tools = this.serverTools.get(serverName);
    if (!tools || tools.size === 0) {
      this.registeredServerTools.delete(serverName);
      return;
    }

    const registeredNames = new Set<string>();
    for (const [toolName, toolDefinition] of tools.entries()) {
      const existingOwner = this.registeredToolOwners.get(toolName);
      if (existingOwner && existingOwner !== serverName) {
        throw new Error(`MCP tool name collision between servers "${serverName}" and "${existingOwner}": ${toolName}`);
      }

      this.registeredToolOwners.set(toolName, serverName);
      this.registeredTools.set(toolName, toolDefinition);
      registeredNames.add(toolName);
    }

    this.registeredServerTools.set(serverName, registeredNames);
  }

  private async cleanupServerConnection(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    if (client) {
      await client.close().catch(() => {});
      this.clients.delete(serverName);
    }

    const registeredNames = this.registeredServerTools.get(serverName);
    if (registeredNames) {
      for (const toolName of registeredNames) {
        if (this.registeredToolOwners.get(toolName) === serverName) {
          this.registeredToolOwners.delete(toolName);
          this.registeredTools.delete(toolName);
        }
      }
      this.registeredServerTools.delete(serverName);
    }

    this.serverTools.delete(serverName);
  }

  async connectOne(name: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(name)) {
      await this.disconnectOne(name);
    }

    this.serverStatus.set(name, {
      name,
      status: 'connecting',
      config,
      toolCount: 0
    });

    try {
      await this.connectServer(name, config);
      const tools = this.getServerTools(name);
      if (tools.length > 0) {
        await this.notifyToolsLoaded(name, tools);
      }
      this.markServerToolsRegistered(name);

      const info = this.serverStatus.get(name)!;
      info.status = 'connected';
      info.error = undefined;
      info.connectedAt = new Date();
      info.toolCount = this.getServerToolCount(name);

      this.log.info('MCP 服务器就绪', { server: name, toolCount: info.toolCount });
    } catch (error) {
      await this.cleanupServerConnection(name);
      const info = this.serverStatus.get(name)!;
      info.status = 'failed';
      info.error = error instanceof Error ? error.message : String(error);
      info.toolCount = 0;
      info.connectedAt = undefined;
      throw error;
    }
  }

  async disconnectOne(name: string): Promise<void> {
    const removedToolCount = this.getServerToolCount(name);
    await this.cleanupServerConnection(name);

    const info = this.serverStatus.get(name);
    if (info) {
      info.status = 'disconnected';
      info.toolCount = 0;
      info.error = undefined;
    }

    this.log.info('MCP 服务器已断开连接', { server: name, removedToolCount });
  }

  async reconnect(name: string): Promise<void> {
    const info = this.serverStatus.get(name);
    if (!info) {
      throw new Error(`MCP server not found: ${name}`);
    }

    await this.connectOne(name, info.config);
  }

  async close(): Promise<void> {
    for (const serverName of Array.from(this.clients.keys())) {
      await this.cleanupServerConnection(serverName);
    }
    this.serverStatus.clear();
  }
}
