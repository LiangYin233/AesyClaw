import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ToolDefinition, MCPServersConfig, MCPServerConfig } from '../types.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private log = logger.child({ prefix: 'MCP' });
  private static readonly DEFAULT_TIMEOUT = CONSTANTS.MCP_TIMEOUT;

  async connect(config: MCPServersConfig): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config)) {
      if (serverConfig.enabled === false) {
        this.log.info(`Skipping disabled MCP server: ${name}`);
        continue;
      }

      try {
        await this.connectServer(name, serverConfig);
      } catch (error) {
        this.log.error(`Failed to connect server ${name}:`, error);
      }
    }
  }

  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const timeout = config.timeout || MCPClientManager.DEFAULT_TIMEOUT;
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

      const env: Record<string, string> = {};
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
      const argsStr = command.slice(1).join(' ');
      this.log.info(`Connecting to ${name} via stdio: ${command.join(' ')}`);
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
      this.log.info(`Connecting to ${name} via SSE: ${config.url}`);
    } else {
      throw new Error(`MCP server ${name}: invalid transport type ${transportType}`);
    }

    try {
      await Promise.race([
        (async () => {
          await client.connect(transport as never);
          await this.loadTools(client, name);
          this.clients.set(name, client);
          this.log.info(`Connected server: ${name}`);
        })(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`MCP server ${name} connection timeout after ${timeout}ms`)), timeout)
        )
      ]);
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private async loadTools(client: Client, prefix: string): Promise<void> {
    try {
      const response = await client.listTools();

      for (const tool of response.tools || []) {
        const toolName = `${prefix}:${tool.name}`;
        this.tools.set(toolName, {
          name: toolName,
          description: tool.description || '',
          parameters: tool.inputSchema
        });
      }
    } catch (error) {
      this.log.error(`Failed to load tools from ${prefix}:`, error);
    }
  }

  async callTool(name: string, args: Record<string, unknown>, timeout?: number): Promise<string> {
    const colonIndex = name.indexOf(':');
    if (colonIndex === -1) {
      throw new Error('Invalid MCP tool name format, expected format: serverName:toolName');
    }

    const serverName = name.substring(0, colonIndex);
    const toolName = name.substring(colonIndex + 1);

    if (!serverName || !toolName) {
      throw new Error('Invalid MCP tool name format, expected format: serverName:toolName');
    }

    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${serverName}`);
    }

    const requestTimeout = timeout || MCPClientManager.DEFAULT_TIMEOUT;
    
    try {
      const response = await Promise.race<any>([
        client.callTool(
          { name: toolName, arguments: args }
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`MCP tool call timeout after ${requestTimeout}ms`)), requestTimeout)
        )
      ]);

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
    } catch (error) {
      throw error;
    }
  }

  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  async close(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.close();
    }
    this.clients.clear();
    this.tools.clear();
  }
}

