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

  it('assigns collision-resistant names when sanitized MCP tool names collide', async () => {
    const client = makeClient({
      listTools: vi.fn(async () => [
        { name: 'foo.bar', description: 'Dotted tool' },
        { name: 'foo_bar', description: 'Underscore tool' },
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

    const names = manager.getConnected('local')?.tools ?? [];
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toBe(mcpToolName('local', 'foo.bar'));
    expect(names[1]).toMatch(/^local_foo_bar_[a-z0-9]+$/);
    expect(toolRegistry.get(names[0])).toBeDefined();
    expect(toolRegistry.get(names[1])).toBeDefined();
  });

  it('assigns collision-resistant names across MCP servers with colliding sanitized names', async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([
        { name: 'local.one', transport: 'stdio', enabled: true },
        { name: 'local_one', transport: 'stdio', enabled: true },
      ]),
      toolRegistry,
      clientFactory: { create: () => makeClient() },
    });

    await manager.connectAll();

    const firstNames = manager.getConnected('local.one')?.tools ?? [];
    const secondNames = manager.getConnected('local_one')?.tools ?? [];
    expect(firstNames).toEqual([mcpToolName('local.one', 'echo')]);
    expect(secondNames).toHaveLength(1);
    const firstName = firstNames[0];
    const secondName = secondNames[0];
    expect(firstName).toBeDefined();
    expect(secondName).toBeDefined();
    if (!firstName || !secondName) {
      throw new Error('Expected MCP tool names to be registered');
    }
    expect(secondName).toMatch(/^local_one_echo_[a-z0-9]+$/);
    expect(toolRegistry.get(firstName)).toBeDefined();
    expect(toolRegistry.get(secondName)).toBeDefined();
  });

  it('passes invalid MCP params through to the client instead of blocking locally', async () => {
    const client = makeClient({
      callTool: vi.fn(async (_name: string, params: unknown) => ({ ok: false, params })),
    });
    const toolRegistry = new ToolRegistry();
    const manager = new McpManager();
    manager.initialize({
      configManager: new FakeConfigManager([{ name: 'local', transport: 'stdio', enabled: true }]),
      toolRegistry,
      clientFactory: { create: () => client },
    });
    await manager.connectAll();

    const tool = toolRegistry.get(mcpToolName('local', 'echo'));
    const invalidParams = {};
    const result = await tool?.execute(invalidParams, {
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
      agentEngine: null,
      cronManager: null,
      pipeline: null,
    });

    expect(client.callTool).toHaveBeenCalledWith('echo', invalidParams);
    expect(result).toEqual({ content: JSON.stringify({ ok: false, params: invalidParams }) });
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
