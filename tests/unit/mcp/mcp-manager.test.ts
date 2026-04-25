import { describe, expect, it, vi } from 'vitest';
import {
  McpManager,
  mcpToolName,
  type McpClient,
  type McpClientFactory,
} from '../../../src/mcp/mcp-manager';
import type { McpServerConfig } from '../../../src/core/config/schema';
import { ToolRegistry } from '../../../src/tool/tool-registry';

class FakeConfigManager {
  constructor(public mcp: McpServerConfig[]) {}

  get(key: 'mcp'): ReadonlyArray<Readonly<McpServerConfig>> {
    if (key !== 'mcp') throw new Error('Unsupported key');
    return this.mcp;
  }
}

function makeClient(overrides: Partial<McpClient> = {}): McpClient {
  return {
    connect: vi.fn(async () => undefined),
    listTools: vi.fn(async () => [{ name: 'echo', description: 'Echo tool' }]),
    callTool: vi.fn(async (_name: string, params: unknown) => ({ ok: true, params })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('McpManager', () => {
  it('connects enabled servers and registers tools with mcp ownership', async () => {
    const inputSchema = {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    };
    const client = makeClient({
      listTools: vi.fn(async () => [{ name: 'echo', description: 'Echo tool', inputSchema }]),
    });
    const factory: McpClientFactory = { create: vi.fn(() => client) };
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([{ name: 'local', transport: 'stdio', enabled: true }]),
      toolRegistry,
      clientFactory: factory,
    });

    await manager.connectAll();

    const tool = toolRegistry.get(mcpToolName('local', 'echo'));
    expect(tool?.owner).toBe('mcp:local');
    expect(tool?.parameters).toEqual(expect.objectContaining(inputSchema));
    expect(manager.getConnected('local')?.tools).toEqual([mcpToolName('local', 'echo')]);
  });

  it('falls back to an unknown record schema for absent or invalid MCP input schemas', async () => {
    const client = makeClient({
      listTools: vi.fn(async () => [
        { name: 'missing', description: 'Missing schema' },
        {
          name: 'invalid',
          description: 'Invalid schema',
          inputSchema: { properties: { text: { type: 'string' } } },
        },
      ]),
    });
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([{ name: 'local', transport: 'stdio', enabled: true }]),
      toolRegistry,
      clientFactory: { create: () => client },
    });

    await manager.connectAll();

    const missingSchema = toolRegistry.get(mcpToolName('local', 'missing'))?.parameters;
    const invalidSchema = toolRegistry.get(mcpToolName('local', 'invalid'))?.parameters;
    expect(missingSchema).toEqual(expect.objectContaining({ type: 'object' }));
    expect(invalidSchema).toEqual(expect.objectContaining({ type: 'object' }));
    expect(invalidSchema).not.toEqual(
      expect.objectContaining({ properties: { text: { type: 'string' } } }),
    );
  });

  it('executes MCP tools through the owning client and returns structured failures', async () => {
    const client = makeClient();
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([{ name: 'local', transport: 'stdio', enabled: true }]),
      toolRegistry,
      clientFactory: { create: () => client },
    });
    await manager.connectAll();

    const tool = toolRegistry.get(mcpToolName('local', 'echo'));
    const result = await tool?.execute(
      { text: 'hi' },
      {
        sessionKey: { channel: 'test', type: 'private', chatId: '1' },
        agentEngine: null,
        cronManager: null,
        pipeline: null,
      },
    );

    expect(client.callTool).toHaveBeenCalledWith('echo', { text: 'hi' });
    expect(result).toEqual({ content: JSON.stringify({ ok: true, params: { text: 'hi' } }) });
  });

  it('isolates failed servers and unregisters tools on disconnect', async () => {
    const goodClient = makeClient();
    const badClient = makeClient({
      connect: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([
        { name: 'bad', transport: 'stdio', enabled: true },
        { name: 'good', transport: 'stdio', enabled: true },
      ]),
      toolRegistry,
      clientFactory: { create: (config) => (config.name === 'bad' ? badClient : goodClient) },
    });

    await manager.connectAll();
    expect(manager.getConnected('good')).toBeDefined();
    expect(manager.getConnected('bad')).toBeUndefined();
    expect(manager.listServers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'bad', state: 'failed' }),
        expect.objectContaining({ name: 'good', state: 'connected' }),
      ]),
    );

    await manager.disconnect('good');
    expect(toolRegistry.has(mcpToolName('good', 'echo'))).toBe(false);
  });
});
