import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ToolDefinition, MCPServersConfig, MCPServerConfig, MCPServerInfo } from '../types.js';
import { logger } from '../observability/index.js';
import { CONSTANTS } from '../constants/index.js';

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private serverStatus: Map<string, MCPServerInfo> = new Map();
  private toolLoadCallbacks: Array<(tools: ToolDefinition[]) => void> = [];
  private log = logger.child('MCP');
  private static readonly DEFAULT_TIMEOUT = CONSTANTS.MCP_TIMEOUT;

  /**
   * 非阻塞连接 - 后台异步连接所有服务器
   */
  async connectAsync(config: MCPServersConfig): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(config)) {
      if (serverConfig.enabled === false) {
        this.log.debug('Skipping disabled MCP server', { server: name });
        continue;
      }

      this.serverStatus.set(name, { // 初始化连接状态
        name,
        status: 'connecting',
        config: serverConfig,
        toolCount: 0
      });

      const promise = this.connectServer(name, serverConfig) // 后台异步连接
        .then(() => {
          const info = this.serverStatus.get(name)!;
          info.status = 'connected';
          info.connectedAt = new Date();
          info.toolCount = this.getServerToolCount(name);
          this.log.info('MCP server ready', { server: name, toolCount: info.toolCount });

          const tools = this.getServerTools(name);
          if (tools.length > 0) {
            this.notifyToolsLoaded(tools); // 通知工具已加载
          }
        })
        .catch((error) => {
          const info = this.serverStatus.get(name)!;
          info.status = 'failed';
          info.error = error instanceof Error ? error.message : String(error);
          this.log.error(`MCP server connection failed: ${name}`, error);
        });

      promises.push(promise);
    }

    Promise.all(promises) // 后台异步连接，不阻塞启动
      .then(() => {
        this.log.info('All MCP server connections completed');
      })
      .catch((error) => {
        this.log.error('MCP server connection loop failed', { error }); // 错误已记录，避免未处理的 Promise 拒绝
      });
  }

  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const timeout = config.timeout ?? MCPClientManager.DEFAULT_TIMEOUT;
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

      const env: Record<string, string> = { ...process.env } as Record<string, string>; // 继承系统环境变量
      if (config.environment) { // 合并配置的环境变量
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
      this.log.info('Connecting to MCP server', { server: name, transport: 'stdio' });
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
      this.log.info('Connecting to MCP server', { server: name, transport: 'sse' });
    } else {
      throw new Error(`MCP server ${name}: invalid transport type ${transportType}`);
    }

    try {
      await Promise.race([
        (async () => {
          await client.connect(transport as never);
          await this.loadTools(client, name);
          this.clients.set(name, client);
          this.log.debug('MCP transport connected', { server: name });
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`MCP server ${name} connection timeout after ${timeout}ms`)), timeout)
        )
      ]);
    } catch (error) {
      await client.close();
      throw new Error(`Failed to connect to MCP server ${name}`, { cause: error });
    }
  }

  private async loadTools(client: Client, prefix: string): Promise<void> {
    try {
      const response = await client.listTools();

      for (const tool of response.tools || []) {
        const toolName = `mcp_${prefix}_${tool.name}`;
        this.tools.set(toolName, {
          name: toolName,
          description: tool.description || '',
          parameters: tool.inputSchema
        });
      }

      this.log.info('MCP tools loaded', { server: prefix, toolCount: response.tools?.length || 0 });
    } catch (error) {
      this.log.error('MCP tool loading failed', { server: prefix, error });
    }
  }

  async callTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<string> {
    const mcpPrefix = 'mcp_'; // 工具名称格式: mcp_{serverName}_{toolName}，例如: mcp_mcp1_get_gdp
    if (!name.startsWith(mcpPrefix)) {
      throw new Error('Invalid MCP tool name format, expected format: mcp_serverName_toolName');
    }

    const rest = name.substring(mcpPrefix.length);
    const underscoreIndex = rest.indexOf('_');
    if (underscoreIndex === -1) {
      throw new Error('Invalid MCP tool name format, expected format: mcp_serverName_toolName');
    }

    const serverName = rest.substring(0, underscoreIndex);
    const toolName = rest.substring(underscoreIndex + 1);

    if (!serverName || !toolName) {
      throw new Error('Invalid MCP tool name format');
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const requestTimeout = timeout ?? MCPClientManager.DEFAULT_TIMEOUT;

    this.log.debug('MCP tool started', { server: serverName, toolName, argKeys: Object.keys(args || {}) });

    let parsedArgs = args; // 确保 args 是一个对象
    if (typeof args === 'string') {
      try {
        parsedArgs = JSON.parse(args);
      } catch (error) {
        throw new Error(`Invalid arguments format: expected object, got string that cannot be parsed as JSON`, { cause: error });
      }
    }

    if (!parsedArgs || typeof parsedArgs !== 'object' || Array.isArray(parsedArgs)) {
      throw new Error(`Invalid arguments: expected object, got ${typeof parsedArgs}`);
    }

    let response;
    response = await Promise.race<any>([
      client.callTool(
        { name: toolName, arguments: parsedArgs }
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`MCP tool call timeout after ${requestTimeout}ms`)), requestTimeout)
      )
    ]);

    this.log.debug('MCP tool completed', { server: serverName, toolName, contentItems: response?.content?.length || 0 });

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
    return Array.from(this.tools.values());
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 注册工具加载回调
   */
  onToolsLoaded(callback: (tools: ToolDefinition[]) => void): void {
    this.toolLoadCallbacks.push(callback);
  }

  /**
   * 触发工具加载回调
   */
  private notifyToolsLoaded(tools: ToolDefinition[]): void {
    for (const callback of this.toolLoadCallbacks) {
      try {
        callback(tools);
      } catch (error) {
        this.log.error('MCP tool callback failed', { error });
      }
    }
  }

  /**
   * 获取服务器状态
   */
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

  /**
   * 获取指定服务器的工具数量
   */
  private getServerToolCount(serverName: string): number {
    let count = 0;
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(`mcp_${serverName}_`)) {
        count++;
      }
    }
    return count;
  }

  /**
   * 获取指定服务器的所有工具
   */
  private getServerTools(serverName: string): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const [toolName, toolDef] of this.tools.entries()) {
      if (toolName.startsWith(`mcp_${serverName}_`)) {
        tools.push(toolDef);
      }
    }
    return tools;
  }

  /**
   * 获取指定服务器的所有工具（公共方法）
   */
  getToolsForServer(serverName: string): ToolDefinition[] {
    return this.getServerTools(serverName);
  }

  /**
   * 动态连接单个服务器
   */
  async connectOne(name: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(name)) { // 如果已连接,先断开
      await this.disconnectOne(name);
    }

    this.serverStatus.set(name, { // 更新连接状态
      name,
      status: 'connecting',
      config,
      toolCount: 0
    });

    try {
      await this.connectServer(name, config);

      const info = this.serverStatus.get(name)!;
      info.status = 'connected';
      info.connectedAt = new Date();
      info.toolCount = this.getServerToolCount(name);

      const tools = this.getServerTools(name);
      if (tools.length > 0) {
        this.notifyToolsLoaded(tools); // 通知工具已加载
      }

      this.log.info('MCP server ready', { server: name, toolCount: info.toolCount });
    } catch (error) {
      const info = this.serverStatus.get(name)!;
      info.status = 'failed';
      info.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * 断开单个服务器
   */
  async disconnectOne(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) {
      return;
    }

    const toolsToRemove: string[] = []; // 收集需要移除的工具
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(`mcp_${name}_`)) {
        toolsToRemove.push(toolName);
      }
    }

    for (const toolName of toolsToRemove) {
      this.tools.delete(toolName);
    }

    await client.close(); // 关闭客户端连接
    this.clients.delete(name);

    const info = this.serverStatus.get(name); // 更新服务器状态
    if (info) {
      info.status = 'disconnected';
      info.toolCount = 0;
    }

    this.log.info('MCP server disconnected', { server: name, removedToolCount: toolsToRemove.length });
  }

  /**
   * 重新连接服务器
   */
  async reconnect(name: string): Promise<void> {
    const info = this.serverStatus.get(name);
    if (!info) {
      throw new Error(`MCP server not found: ${name}`);
    }

    await this.connectOne(name, info.config);
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.tools.clear();
  }
}
