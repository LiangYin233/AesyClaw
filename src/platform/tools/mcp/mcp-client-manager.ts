/** @file MCP 客户端管理器
 *
 * 使用 @modelcontextprotocol/sdk 管理 MCP 服务器连接与工具注册。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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
    private clients: Map<string, Client> = new Map();
    private transports: Map<string, StdioClientTransport> = new Map();
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

        if (this.clients.has(config.name)) {
            logger.warn({ serverName: config.name }, 'MCP 服务器已连接，跳过');
            return;
        }

        logger.info({ serverName: config.name, command: config.command }, '正在连接 MCP 服务器');

        const client = new Client({ name: 'aesyclaw', version: '1.0.0' });
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            ...(config.env ? { env: config.env } : {}),
            ...(config.cwd ? { cwd: config.cwd } : {}),
            ...(config.stderr ? { stderr: config.stderr } : {}),
        });

        const toolScope = this.toolManager.createScope(createRegistrationOwner('mcp', config.name));

        try {
            await client.connect(transport);
            const toolsResult = await client.listTools();
            const tools = toolsResult.tools || [];

            for (const tool of tools) {
                const adapter = new McpToolAdapter(config.name, tool, async (toolName, args) => {
                    const result = await client.callTool({ name: toolName, arguments: args });
                    // 处理 result
                    if ('content' in result && Array.isArray(result.content)) {
                        const textParts = result.content
                            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
                            .map((c) => c.text);
                        const isError = result.isError || false;
                        return {
                            success: !isError,
                            content: textParts.join('\n'),
                            ...(isError ? { error: textParts.join('\n') } : {}),
                        };
                    }
                    if ('toolResult' in result) {
                        return {
                            success: true,
                            content: JSON.stringify(result.toolResult),
                        };
                    }
                    return {
                        success: true,
                        content: JSON.stringify(result),
                    };
                });
                toolScope.register(adapter);
            }

            this.clients.set(config.name, client);
            this.transports.set(config.name, transport);
            this.toolScopes.set(config.name, toolScope);

            this.serverInfos.set(config.name, {
                name: config.name,
                connected: true,
                lastChecked: new Date(),
                toolCount: tools.length,
            });

            logger.info({ serverName: config.name, toolCount: tools.length }, 'MCP 服务器连接成功');
        } catch (error) {
            toolScope.dispose();

            try {
                await transport.close();
            } catch (closeError) {
                logger.warn(
                    { serverName: config.name, error: closeError },
                    'MCP 服务器连接失败后清理未完成',
                );
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

    async disconnectServer(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);
        const transport = this.transports.get(serverName);
        const toolScope = this.toolScopes.get(serverName);

        toolScope?.dispose();

        if (client) {
            try {
                await client.close();
            } catch (error) {
                logger.warn({ serverName, error }, '关闭 MCP client 失败');
            }
        }

        if (transport) {
            try {
                await transport.close();
            } catch (error) {
                logger.warn({ serverName, error }, '关闭 MCP transport 失败');
            }
        }

        this.toolScopes.delete(serverName);
        this.clients.delete(serverName);
        this.transports.delete(serverName);
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

        for (const serverName of Array.from(this.clients.keys())) {
            try {
                await this.disconnectServer(serverName);
            } catch (error) {
                logger.error({ serverName, error }, '关闭 MCP 客户端失败');
            }
        }
    }
}
