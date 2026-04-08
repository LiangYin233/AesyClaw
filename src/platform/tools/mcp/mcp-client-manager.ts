import type { ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { logger } from '../../observability/logger.js';
import { ToolRegistry } from '../registry.js';
import { McpToolAdapter, MCPServerInfo, MCPToolInfo } from './types.js';
import type { MCPServerConfig } from '../../../features/config/schema.js';

// 直接使用 Client 类型，通过类型断言处理 request 方法
// 由于 Client 类型的 request 方法签名与我们的使用方式不同，我们需要使用类型断言

interface StdioClientTransportWithProcess extends StdioClientTransport {
  childProcess: ChildProcess;
}



export class McpClientManager {
  private static instance: McpClientManager | undefined;
  
  private clients: Map<string, Client> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private toolRegistry: ToolRegistry;
  private serverInfos: Map<string, MCPServerInfo> = new Map();

  private constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  static getInstance(toolRegistry: ToolRegistry): McpClientManager {
    if (!McpClientManager.instance) {
      McpClientManager.instance = new McpClientManager(toolRegistry);
    }
    return McpClientManager.instance;
  }

  static resetInstance(): void {
    if (McpClientManager.instance) {
      McpClientManager.instance.shutdown();
      McpClientManager.instance = undefined;
    }
  }

  async connectServer(config: MCPServerConfig): Promise<void> {
    if (!config.enabled) {
      logger.info({ serverName: config.name }, 'MCP 服务器已禁用，跳过连接');
      return;
    }

    if (this.clients.has(config.name)) {
      logger.warn({ serverName: config.name }, 'MCP 服务器已连接，跳过');
      return;
    }

    logger.info({ serverName: config.name, command: config.command }, '正在连接 MCP 服务器');

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env as Record<string, string>,
      });

      const client = new Client({
        name: `aesyclaw-${config.name}`,
        version: '1.0.0',
      }, {
        capabilities: {},
      });

      await client.connect(transport);
      this.clients.set(config.name, client);
      this.processes.set(config.name, (transport as StdioClientTransportWithProcess).childProcess);

      await this.syncTools(config.name, client);

      this.serverInfos.set(config.name, {
        name: config.name,
        connected: true,
        lastChecked: new Date(),
        toolCount: 0,
      });

      logger.info({ serverName: config.name }, 'MCP 服务器连接成功');
    } catch (error) {
      logger.error({ serverName: config.name, error }, 'MCP 服务器连接失败');
      this.serverInfos.set(config.name, {
        name: config.name,
        connected: false,
        lastChecked: new Date(),
        error: error instanceof Error ? error.message : String(error),
        toolCount: 0,
      });
    }
  }

  private async syncTools(serverName: string, client: Client): Promise<void> {
    try {
      const response = await (client as { request: (_params: { method: string; params: Record<string, unknown> }) => Promise<{ tools?: MCPToolInfo[] }> }).request({
        method: 'tools/list',
        params: {},
      });

      const tools = response.tools || [];
      logger.info({ serverName, toolCount: tools.length }, '同步 MCP 工具');

      for (const toolInfo of tools) {
        const adapter = new McpToolAdapter(
          serverName,
          toolInfo as MCPToolInfo,
          async (args) => {
            return this.executeTool(serverName, toolInfo.name, args);
          }
        );

        this.toolRegistry.register(adapter);
      }

      const info = this.serverInfos.get(serverName);
      if (info) {
        info.toolCount = tools.length;
      }
    } catch (error) {
      logger.error({ serverName, error }, '同步 MCP 工具失败');
    }
  }

  private async executeTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ success: boolean; content: string; error?: string }> {
    const client = this.clients.get(serverName);
    if (!client) {
      return { success: false, content: '', error: `MCP 客户端 ${serverName} 未连接` };
    }

    try {
      const response = await (client as { request: (_params: { method: string; params: Record<string, unknown> }) => Promise<{ content?: Array<{ text?: string; data?: unknown }> }> }).request({
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      });

      const content = response.content || [];
      const textParts: string[] = [];
      
      for (const item of content) {
        if (item && typeof item === 'object') {
          if ('text' in item) {
            textParts.push(String(item.text));
          } else if ('data' in item) {
            textParts.push(`[data: ${item.data}]`);
          }
        }
      }

      return { success: true, content: textParts.join('\n') || '(no output)' };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnectServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName);
    const process = this.processes.get(serverName);

    if (client) {
      await client.close();
      this.clients.delete(serverName);
    }

    if (process) {
      process.kill();
      this.processes.delete(serverName);
    }

    this.serverInfos.delete(serverName);
    logger.info({ serverName }, 'MCP 服务器已断开');
  }

  async connectConfiguredServers(configs: MCPServerConfig[]): Promise<void> {
    logger.info({ count: configs.length }, '开始连接 MCP 服务器');

    for (const config of configs) {
      await this.connectServer(config);
    }

    const connected = this.getConnectedServers();
    logger.info({ connected: connected.length }, 'MCP 服务器连接完成');
  }

  getConnectedServers(): MCPServerInfo[] {
    return Array.from(this.serverInfos.values());
  }

  getServerStatus(serverName: string): MCPServerInfo | undefined {
    return this.serverInfos.get(serverName);
  }

  shutdown(): void {
    logger.info('关闭 MCP 客户端管理器');

    for (const [, client] of this.clients) {
      client.close().catch((err) => {
        logger.error({ error: err }, '关闭 MCP 客户端失败');
      });
    }

    for (const [, process] of this.processes) {
      process.kill();
    }

    this.clients.clear();
    this.processes.clear();
    this.serverInfos.clear();
  }
}
