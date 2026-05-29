import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../../../src/extension/channel/manager';
import type { ChannelContext, ChannelPlugin } from '../../../src/extension/channel/types';
import type { Message, OutboundSignal, SessionKey, SenderInfo } from '../../../src/core/types';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { CommandRegistry } from '../../../src/command/command-registry';

const fakePaths = {
  runtimeRoot: '/tmp/aesyclaw/.aesyclaw',
  dataDir: '/tmp/aesyclaw/.aesyclaw/data',
  configFile: '/tmp/aesyclaw/.aesyclaw/config.json',
  dbFile: '/tmp/aesyclaw/.aesyclaw/data/aesyclaw.db',
  rolesFile: '/tmp/aesyclaw/.aesyclaw/roles.json',
  mediaDir: '/tmp/aesyclaw/.aesyclaw/media',
  workspaceDir: '/tmp/aesyclaw/.aesyclaw/workspace',
  skillsDir: '/tmp/aesyclaw/skills',
  userSkillsDir: '/tmp/aesyclaw/.aesyclaw/skills',
  extensionsDir: '/tmp/aesyclaw/extensions',
  webDistDir: '/tmp/aesyclaw/dist',
};

class FakeConfigManager {
  channels: Record<string, unknown> = {};
  defaults: Array<{ key: string; defaults: Record<string, unknown> }> = [];

  get(path: string): unknown {
    if (path === 'channels') return this.channels;
    if (path.startsWith('channels.')) {
      const channelName = path.slice('channels.'.length);
      return this.channels[channelName];
    }
    throw new Error('Unsupported key');
  }

  async set(path: string, value: unknown): Promise<void> {
    if (
      path === 'channels' &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      this.channels = value as Record<string, unknown>;
      return;
    }
    throw new Error('Unsupported key');
  }

  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.defaults.push({ key, defaults });
  }
}

function makePipeline() {
  return {
    receiveWithSend: vi.fn(
      async (
        _message: Message,
        sessionKey: SessionKey,
        _sender: SenderInfo | undefined,
        send: (signal: OutboundSignal) => Promise<void>,
      ) => {
        await send({
          kind: 'message' as const,
          session: sessionKey,
          content: { components: [{ type: 'Plain', text: 'pipeline response' }] },
        });
      },
    ),
  };
}

function makeChannel(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    name: 'test',
    version: '1.0.0',
    defaultConfig: { token: 'default' },
    streaming: false,
    init: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    ...overrides,
  };
}

function makeManager(options: {
  configManager: FakeConfigManager;
  pipeline: ReturnType<typeof makePipeline>;
  channels?: ChannelPlugin[];
  toolRegistry?: ToolRegistry;
  commandRegistry?: CommandRegistry;
}): ChannelManager {
  return new ChannelManager({
    configManager: options.configManager,
    pipeline: options.pipeline,
    channels: options.channels,
    paths: fakePaths,
    toolRegistry: options.toolRegistry ?? new ToolRegistry(),
    commandRegistry: options.commandRegistry ?? new CommandRegistry(),
    hooksBus: { dispatch: vi.fn(async () => ({ action: 'next' })) },
    sessionManager: {
      get: vi.fn(),
      create: vi.fn(async () => ({
        key: { channel: 'test', type: 'private', chatId: '1' },
        get: vi.fn(() => []),
      })),
    },
    llmAdapter: { resolveModel: vi.fn(() => ({ contextWindow: 128_000 })) },
    databaseManager: {
      sessions: {
        findAllSummaries: vi.fn(async () => []),
        findById: vi.fn(async () => null),
      },
      messages: {
        loadHistory: vi.fn(async () => []),
      },
    },
  });
}

describe('ChannelManager', () => {
  it('starts enabled channels with merged config and receives messages through the manager', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { enabled: true, token: 'configured' } };
    const pipeline = makePipeline();
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        expect(ctx.config).toEqual({ token: 'configured' });
        expect(ctx.receive).toEqual(expect.any(Function));
      }),
    });
    const manager = makeManager({
      configManager: config,
      pipeline,
      channels: [channel],
    });

    await manager.startAll();
    await manager.receive(
      'test',
      { components: [{ type: 'Plain', text: 'hi' }] },
      { channel: 'test', type: 'private', chatId: '1' },
    );

    expect(channel.init).toHaveBeenCalledOnce();
    expect(pipeline.receiveWithSend).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith({
      kind: 'message',
      session: { channel: 'test', type: 'private', chatId: '1' },
      content: { components: [{ type: 'Plain', text: 'pipeline response' }] },
    });
    expect(manager.getLoaded('test')).toBeDefined();
  });

  it('exposes context receive as a bridge back into ChannelManager.receive', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { enabled: true } };
    const pipeline = makePipeline();
    const captured: {
      receive?: (message: Message, sessionKey: SessionKey, sender?: SenderInfo) => Promise<void>;
    } = {};
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        captured.receive = ctx.receive;
      }),
    });
    const manager = makeManager({
      configManager: config,
      pipeline,
      channels: [channel],
    });

    await manager.start('test');
    if (!captured.receive) {
      throw new Error('receive context was not captured');
    }
    await captured.receive(
      { components: [{ type: 'Plain', text: 'hi' }] },
      { channel: 'test', type: 'private', chatId: '1' },
    );

    expect(pipeline.receiveWithSend).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith({
      kind: 'message',
      session: { channel: 'test', type: 'private', chatId: '1' },
      content: { components: [{ type: 'Plain', text: 'pipeline response' }] },
    });
  });

  it('errors when receiving for an unloaded channel', async () => {
    const manager = makeManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
    });

    await expect(
      manager.receive(
        'missing',
        { components: [{ type: 'Plain', text: 'hi' }] },
        { channel: 'missing', type: 'private', chatId: '1' },
      ),
    ).rejects.toThrow('频道 "missing" 未加载');
  });

  it('backfills nested default config while preserving configured channel values', async () => {
    const config = new FakeConfigManager();
    config.channels = {
      test: {
        enabled: true,
        token: 'configured',
        nested: { retries: 5 },
      },
    };

    const channel = makeChannel({
      defaultConfig: {
        token: 'default',
        nested: { retries: 3, timeoutMs: 1000 },
      },
      init: vi.fn(async (ctx) => {
        expect(ctx.config).toEqual({
          enabled: true,
          token: 'configured',
          nested: { retries: 5, timeoutMs: 1000 },
        });
      }),
    });

    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
    });

    await manager.startAll();

    expect(channel.init).toHaveBeenCalledOnce();
  });

  it('skips disabled channels and isolates startup failures', async () => {
    const config = new FakeConfigManager();
    config.channels = {
      disabled: { enabled: false },
      good: { enabled: true },
      bad: { enabled: true },
    };
    const good = makeChannel({ name: 'good' });
    const disabled = makeChannel({ name: 'disabled' });
    const bad = makeChannel({
      name: 'bad',
      init: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [bad, disabled, good],
    });

    await expect(manager.startAll()).resolves.toBeUndefined();

    expect(manager.getLoaded('good')).toBeDefined();
    expect(manager.getLoaded('bad')).toBeUndefined();
    expect(manager.listChannels()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'bad', state: 'failed' }),
        expect.objectContaining({ name: 'disabled', state: 'disabled' }),
        expect.objectContaining({ name: 'good', state: 'loaded' }),
      ]),
    );
  });

  it('sends through the loaded channel and stops with cleanup', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { enabled: true } };
    const channel = makeChannel();
    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
    });

    await manager.start('test');
    await manager.send({
      kind: 'message',
      session: { channel: 'test', type: 'private', chatId: '1' },
      content: { components: [{ type: 'Plain', text: 'hello' }] },
    });
    await manager.stopAll();

    expect(channel.send).toHaveBeenCalledWith({
      kind: 'message',
      session: { channel: 'test', type: 'private', chatId: '1' },
      content: { components: [{ type: 'Plain', text: 'hello' }] },
    });
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(manager.getLoaded('test')).toBeUndefined();
  });

  it('rejects dynamically discovered channels missing send', async () => {
    const { isChannelPlugin } = await import('../../../src/extension/channel/types');
    const base = {
      name: 'dynamic',
      version: '1.0.0',
      init: vi.fn(async () => undefined),
    };

    // 未提供 send → 非法
    expect(isChannelPlugin(base)).toBe(false);
    // 提供 send → 合法
    expect(
      isChannelPlugin({
        ...base,
        send: vi.fn(async () => undefined),
      }),
    ).toBe(true);
  });

  it('discovers only static default or channel exports', async () => {
    const { discoverChannelDefinition } = await import('../../../src/extension/channel/types');
    const staticChannel = makeChannel({ name: 'static' });

    expect(discoverChannelDefinition({ default: staticChannel })).toBe(staticChannel);
    expect(discoverChannelDefinition({ channel: staticChannel })).toBe(staticChannel);
    expect(discoverChannelDefinition({ createChannel: () => staticChannel })).toBeNull();
    expect(discoverChannelDefinition({ createOneBotChannel: () => staticChannel })).toBeNull();
  });

  it('provides host paths to channel init contexts', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { enabled: true } };
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        expect(ctx.paths).toBe(fakePaths);
      }),
    });
    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
    });

    await manager.start('test');

    expect(channel.init).toHaveBeenCalledOnce();
  });

  it('lets channels register tools and commands, list commands, and cleans them on stop', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { enabled: true } };
    const toolRegistry = new ToolRegistry();
    const commandRegistry = new CommandRegistry();
    const channel = makeChannel({
      init: vi.fn(async (ctx: ChannelContext) => {
        ctx.registerTool({
          name: 'channel_tool',
          description: 'Channel tool',
          parameters: Type.Object({}),
          owner: 'system',
          execute: async () => ({ content: 'ok' }),
        });
        ctx.registerCommand({
          name: 'channelcmd',
          description: 'Channel command',
          scope: 'system',
          execute: async () => 'ok',
        });

        const commands = ctx.getCommands();
        expect(commands.map((command) => command.name)).toContain('channelcmd');
        expect(commands.some((command) => 'execute' in command)).toBe(false);
      }),
    });
    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
      toolRegistry,
      commandRegistry,
    });

    await manager.start('test');

    expect(toolRegistry.get('channel_tool')?.owner).toBe('channel:test');
    expect(commandRegistry.getAll()[0]?.scope).toBe('channel:test');

    await manager.stop('test');

    expect(toolRegistry.get('channel_tool')).toBeUndefined();
    expect(commandRegistry.getAll()).toEqual([]);
  });

  it('enables and disables channels through manager APIs', async () => {
    const config = new FakeConfigManager();
    const channel = makeChannel();
    const manager = makeManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
    });

    await manager.startAll();
    expect(manager.getLoaded('test')).toBeUndefined();

    await manager.enable('test');
    expect(manager.getLoaded('test')).toBeDefined();
    expect(config.channels['test']).toMatchObject({ enabled: true, token: 'default' });

    await manager.disable('test');
    expect(manager.getLoaded('test')).toBeUndefined();
    expect(config.channels['test']).toMatchObject({ enabled: false, token: 'default' });
  });

  it('rejects duplicate channel registrations to avoid unsafe ownership cleanup', () => {
    const manager = makeManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
    });
    const first = makeChannel({ name: 'duplicate' });
    const second = makeChannel({ name: 'duplicate' });

    manager.register(first);

    expect(() => manager.register(second)).toThrow(/已注册/);
    expect(manager.has('duplicate')).toBe(true);
  });

  it('coalesces overlapping config reload requests into a follow-up reload pass', async () => {
    const manager = makeManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
    });
    const firstReload = manager.handleConfigReload();
    await Promise.resolve();
    const secondReload = manager.handleConfigReload();
    await expect(Promise.all([firstReload, secondReload])).resolves.toBeDefined();
  });
});
