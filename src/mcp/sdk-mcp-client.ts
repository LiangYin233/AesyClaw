/** MCP SDK client adapter for configured stdio, SSE, and streamable HTTP servers. */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../core/config/schema';
import type { McpClient, McpClientFactory, McpToolDefinition } from './mcp-manager';

export class SdkMcpClientFactory implements McpClientFactory {
  create(config: McpServerConfig): McpClient {
    return new SdkMcpClient(config);
  }
}

class SdkMcpClient implements McpClient {
  private readonly client = new Client({
    name: 'aesyclaw',
    version: '0.1.0',
  });
  private transport: Transport | null = null;

  constructor(private readonly config: McpServerConfig) {}

  async connect(): Promise<void> {
    if (this.transport) {
      return;
    }

    const transport = createTransport(this.config);
    await this.client.connect(transport);
    this.transport = transport;
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, params: unknown): Promise<unknown> {
    return this.client.callTool({
      name,
      arguments: isRecord(params) ? params : {},
    });
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.transport = null;
    }
  }
}

function createTransport(config: McpServerConfig): Transport {
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(`MCP stdio server "${config.name}" requires a command`);
    }

    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env ? { ...getDefaultEnvironment(), ...config.env } : undefined,
    });
  }

  if (!config.url) {
    throw new Error(`MCP ${config.transport} server "${config.name}" requires a url`);
  }

  const url = new URL(config.url);
  if (config.transport === 'sse') {
    return new SSEClientTransport(url);
  }

  return new StreamableHTTPClientTransport(url);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
