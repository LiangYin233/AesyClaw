import { describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../../../src/extension/channel/channel-manager';
import type { ChannelPlugin } from '../../../src/extension/channel/channel-types';
import type { Message, SessionKey, SenderInfo } from '../../../src/core/types';

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

  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.defaults.push({ key, defaults });
  }
}

function makePipeline() {
  return {
    receiveWithSend: vi.fn(
      async (
        _message: Message,
        _sessionKey: SessionKey,
        _sender: SenderInfo | undefined,
        send: (m: Message) => Promise<void>,
      ) => {
        await send({ components: [{ type: 'Plain', text: 'pipeline response' }] });
      },
    ),
  };
}

function makeChannel(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    name: 'test',
    version: '1.0.0',
    defaultConfig: { enabled: true, token: 'default' },
    init: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    receive: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ChannelManager', () => {
  it('starts enabled channels with merged config and receives messages through the manager', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { token: 'configured' } };
    const pipeline = makePipeline();
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        expect(ctx.config).toEqual({ enabled: true, token: 'configured' });
        expect(ctx.receive).toEqual(expect.any(Function));
      }),
    });
    const manager = new ChannelManager({
      configManager: config,
      pipeline,
      channels: [channel],
      paths: fakePaths,
    });

    await manager.startAll();
    await manager.receive(
      'test',
      { components: [{ type: 'Plain', text: 'hi' }] },
      { channel: 'test', type: 'private', chatId: '1' },
    );

    expect(channel.init).toHaveBeenCalledOnce();
    expect(pipeline.receiveWithSend).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { components: [{ type: 'Plain', text: 'pipeline response' }] },
    );
    expect(manager.getLoaded('test')).toBeDefined();
  });

  it('exposes context receive as a bridge back into ChannelManager.receive', async () => {
    const pipeline = makePipeline();
    let receiveFromContext:
      | ((message: Message, sessionKey: SessionKey, sender?: SenderInfo) => Promise<void>)
      | null = null;
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        receiveFromContext = ctx.receive;
      }),
    });
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline,
      channels: [channel],
      paths: fakePaths,
    });

    await manager.start('test');
    await receiveFromContext?.(
      { components: [{ type: 'Plain', text: 'hi' }] },
      { channel: 'test', type: 'private', chatId: '1' },
    );

    expect(pipeline.receiveWithSend).toHaveBeenCalledOnce();
    expect(channel.send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { components: [{ type: 'Plain', text: 'pipeline response' }] },
    );
  });

  it('errors when receiving for an unloaded channel', async () => {
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      paths: fakePaths,
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
        token: 'configured',
        nested: { retries: 5 },
      },
    };

    const channel = makeChannel({
      defaultConfig: {
        enabled: true,
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

    const manager = new ChannelManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [channel],
      paths: fakePaths,
    });

    await manager.startAll();

    expect(channel.init).toHaveBeenCalledOnce();
  });

  it('skips disabled channels and isolates startup failures', async () => {
    const config = new FakeConfigManager();
    config.channels = { disabled: { enabled: false } };
    const good = makeChannel({ name: 'good' });
    const disabled = makeChannel({ name: 'disabled' });
    const bad = makeChannel({
      name: 'bad',
      init: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    const manager = new ChannelManager({
      configManager: config,
      pipeline: makePipeline(),
      channels: [bad, disabled, good],
      paths: fakePaths,
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
    const channel = makeChannel();
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      channels: [channel],
      paths: fakePaths,
    });

    await manager.start('test');
    await manager.send(
      { channel: 'test', type: 'private', chatId: '1' },
      { components: [{ type: 'Plain', text: 'hello' }] },
    );
    await manager.stopAll();

    expect(channel.send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { components: [{ type: 'Plain', text: 'hello' }] },
    );
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(manager.getLoaded('test')).toBeUndefined();
  });

  it('rejects dynamically discovered channels missing send or receive', async () => {
    const { isChannelPlugin } = await import('../../../src/extension/channel/channel-types');
    const base = {
      name: 'dynamic',
      version: '1.0.0',
      init: vi.fn(async () => undefined),
    };

    expect(isChannelPlugin({ ...base, send: vi.fn(async () => undefined) })).toBe(false);
    expect(isChannelPlugin({ ...base, receive: vi.fn(async () => undefined) })).toBe(false);
    expect(
      isChannelPlugin({
        ...base,
        send: vi.fn(async () => undefined),
        receive: vi.fn(async () => undefined),
      }),
    ).toBe(true);
  });

  it('discovers only static default or channel exports', async () => {
    const { discoverChannelDefinition } =
      await import('../../../src/extension/channel/channel-types');
    const staticChannel = makeChannel({ name: 'static' });

    expect(discoverChannelDefinition({ default: staticChannel })).toBe(staticChannel);
    expect(discoverChannelDefinition({ channel: staticChannel })).toBe(staticChannel);
    expect(discoverChannelDefinition({ createChannel: () => staticChannel })).toBeNull();
    expect(discoverChannelDefinition({ createOneBotChannel: () => staticChannel })).toBeNull();
  });

  it('provides host paths to channel init contexts', async () => {
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        expect(ctx.paths).toBe(fakePaths);
      }),
    });
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      channels: [channel],
      paths: fakePaths,
    });

    await manager.start('test');

    expect(channel.init).toHaveBeenCalledOnce();
  });

  it('rejects duplicate channel registrations to avoid unsafe ownership cleanup', () => {
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      paths: fakePaths,
    });
    const first = makeChannel({ name: 'duplicate' });
    const second = makeChannel({ name: 'duplicate' });

    manager.register(first);

    expect(() => manager.register(second)).toThrow(/已注册/);
    expect(manager.has('duplicate')).toBe(true);
  });

  it('coalesces overlapping config reload requests into a follow-up reload pass', async () => {
    const manager = new ChannelManager({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      paths: fakePaths,
    });
    let releaseFirstStop: (() => void) | null = null;
    const stopAll = vi
      .spyOn(manager, 'stopAll')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstStop = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const startAll = vi.spyOn(manager, 'startAll').mockResolvedValue(undefined);

    const firstReload = manager.handleConfigReload();
    await Promise.resolve();
    const secondReload = manager.handleConfigReload();
    releaseFirstStop?.();

    await Promise.all([firstReload, secondReload]);

    expect(stopAll).toHaveBeenCalledTimes(2);
    expect(startAll).toHaveBeenCalledTimes(2);
  });
});
