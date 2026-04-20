import { MCPManager, type MCPServerConfig as AesyiuMCPServerConfig } from 'aesyiu';
import { logger } from '../../observability/logger.js';
import { toErrorMessage } from '../../utils/errors.js';
import { createRegistrationOwner } from '@/platform/registration/types.js';
import type { ToolManager } from '../registry.js';
import type { ToolRegistrationPort } from '../tool-manager.js';
import { McpToolAdapter, MCPServerInfo } from './types.js';

export interface McpServerConnectionConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: 'inherit' | 'pipe' | 'ignore' | 'overlapped';
  enabled: boolean;
}

export class McpClientManager {
  private managers: Map<string, MCPManager> = new Map();
  private toolScopes: Map<string, ToolRegistrationPort> = new Map();
  private toolManager: ToolManager;
  private serverInfos: Map<string, MCPServerInfo> = new Map();

  constructor(toolManager: ToolManager) {
    this.toolManager = toolManager;
  }

  async connectServer(config: McpServerConnectionConfig): Promise<void> {
    if (!config.enabled) {
      logger.info({ serverName: config.name }, 'MCP 服务器已禁用，跳过连接');
      return;
    }

    if (this.managers.has(config.name)) {
      logger.warn({ serverName: config.name }, 'MCP 服务器已连接，跳过');
      return;
    }

    logger.info({ serverName: config.name, command: config.command }, '正在连接 MCP 服务器');

    const manager = new MCPManager();
    const toolScope = this.toolManager.createScope(createRegistrationOwner('mcp', config.name));

    try {
      const tools = await manager.registerServer(this.toAesyiuServerConfig(config));
      const adapters = tools.map(tool => new McpToolAdapter(config.name, tool));

      for (const adapter of adapters) {
        toolScope.register(adapter);
      }

      this.managers.set(config.name, manager);
      this.toolScopes.set(config.name, toolScope);

      this.serverInfos.set(config.name, {
        name: config.name,
        connected: true,
        lastChecked: new Date(),
        toolCount: adapters.length,
      });

      logger.info({ serverName: config.name, toolCount: adapters.length }, 'MCP 服务器连接成功');
    } catch (error) {
      toolScope.dispose();

      try {
        await manager.dispose();
      } catch (disposeError) {
        logger.warn({ serverName: config.name, error: disposeError }, 'MCP 服务器连接失败后清理未完成');
      }

      logger.error({ serverName: config.name, error }, 'MCP 服务器连接失败');
      this.serverInfos.set(config.name, {
        name: config.name,
        connected: false,
        lastChecked: new Date(),
        error: toErrorMessage(error),
        toolCount: 0,
      });
    }
  }

  private toAesyiuServerConfig(config: McpServerConnectionConfig): AesyiuMCPServerConfig {
    return {
      name: config.name,
      command: config.command,
      ...(config.args.length > 0 ? { args: config.args } : {}),
      ...(config.env ? { env: config.env } : {}),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      ...(config.stderr ? { stderr: config.stderr } : {}),
    };
  }

  async disconnectServer(serverName: string): Promise<void> {
    const manager = this.managers.get(serverName);
    const toolScope = this.toolScopes.get(serverName);

    toolScope?.dispose();

    if (manager) {
      await manager.dispose();
    }

    this.toolScopes.delete(serverName);
    this.managers.delete(serverName);
    this.serverInfos.delete(serverName);
    logger.info({ serverName }, 'MCP 服务器已断开');
  }

  async connectConfiguredServers(configs: readonly McpServerConnectionConfig[]): Promise<void> {
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

  async shutdown(): Promise<void> {
    logger.info({}, '关闭 MCP 客户端管理器');

    for (const serverName of Array.from(this.managers.keys())) {
      try {
        await this.disconnectServer(serverName);
      } catch (error) {
        logger.error({ serverName, error }, '关闭 MCP 客户端失败');
      }
    }
  }

}
