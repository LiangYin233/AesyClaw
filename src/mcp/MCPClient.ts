import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { ToolDefinition } from '../types.js';
import type { MCPServersConfig } from '../types.js';
import { logger } from '../logger/index.js';

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export class MCPClientManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private log = logger.child({ prefix: 'MCP' });

  async connect(config: MCPServersConfig): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config)) {
      try {
        await this.connectServer(name, serverConfig);
      } catch (error) {
        this.log.error(`Failed to connect server ${name}:`, error);
      }
    }
  }

  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const client = new Client({
      name: `aesyclaw-${name}`,
      version: '0.1.0'
    }, {
      capabilities: {}
    });

    let transport: any;

    if (config.command) {
      const env: Record<string, string> = {};
      for (const key of Object.keys(process.env)) {
        const val = process.env[key];
        if (val !== undefined) env[key] = val;
      }
      if (config.env) {
        for (const key of Object.keys(config.env)) {
          const val = config.env[key];
          if (val !== undefined) env[key] = val;
        }
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env
      });
      this.log.info(`Connecting to ${name} via stdio: ${config.command} ${config.args?.join(' ') || ''}`);
    } else if (config.url) {
      if (config.url.startsWith('http://') || config.url.startsWith('https://')) {
        const sseOptions: any = {};
        if (config.headers) {
          sseOptions.headers = config.headers;
        }
        transport = new SSEClientTransport(new URL(config.url), sseOptions);
        this.log.info(`Connecting to ${name} via SSE: ${config.url}`);
      } else {
        throw new Error(`Invalid URL format: ${config.url}. Must start with http:// or https://`);
      }
    } else {
      throw new Error('MCP server config must have either command or url');
    }

    await client.connect(transport);

    await this.loadTools(client, name);
    this.clients.set(name, client);
    this.log.info(`Connected server: ${name}`);
  }

  private async loadTools(client: Client, prefix: string): Promise<void> {
    try {
      const response = await client.request(
        { method: 'tools/list' } as any,
        {} as any
      );

      for (const tool of response.tools || []) {
        const toolName = `${prefix}:${tool.name}`;
        this.tools.set(toolName, {
          name: toolName,
          description: tool.description,
          parameters: tool.inputSchema
        });
      }
    } catch (error) {
      this.log.error(`Failed to load tools from ${prefix}:`, error);
    }
  }

  async callTool(name: string, args: Record<string, any>): Promise<string> {
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

    const response = await client.request(
      { method: 'tools/call' } as any,
      { name: toolName, arguments: args } as any
    );

    return response.content?.[0]?.text || '';
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
