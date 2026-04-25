import { describe, expect, it, vi } from 'vitest';
import { ChannelManager } from '../../../src/channel/channel-manager';
import type { ChannelPlugin } from '../../../src/channel/channel-types';
import type { InboundMessage, OutboundMessage } from '../../../src/core/types';

class FakeConfigManager {
  channels: Record<string, unknown> = {};
  defaults: Array<{ key: string; defaults: Record<string, unknown> }> = [];

  get(key: 'channels'): Readonly<Record<string, unknown>> {
    if (key !== 'channels') throw new Error('Unsupported key');
    return this.channels;
  }

  registerDefaults(key: string, defaults: Record<string, unknown>): void {
    this.defaults.push({ key, defaults });
  }
}

function makePipeline() {
  return {
    receiveWithSend: vi.fn(async (_message: InboundMessage, send) => {
      await send({ content: 'pipeline response' });
    }),
  };
}

function makeChannel(overrides: Partial<ChannelPlugin> = {}): ChannelPlugin {
  return {
    name: 'test',
    version: '1.0.0',
    defaultConfig: { enabled: true, token: 'default' },
    init: vi.fn(async () => undefined),
    destroy: vi.fn(async () => undefined),
    send: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ChannelManager', () => {
  it('starts enabled channels with merged config and bridges messages to pipeline', async () => {
    const config = new FakeConfigManager();
    config.channels = { test: { token: 'configured' } };
    const pipeline = makePipeline();
    const sent: OutboundMessage[] = [];
    let received: ((message: InboundMessage) => Promise<void>) | null = null;
    const channel = makeChannel({
      init: vi.fn(async (ctx) => {
        expect(ctx.config).toEqual({ enabled: true, token: 'configured' });
        received = (message) =>
          ctx.receiveWithSend(message, async (outbound) => {
            sent.push(outbound);
          });
      }),
    });
    const manager = new ChannelManager();
    manager.initialize({ configManager: config, pipeline, channels: [channel] });

    await manager.startAll();
    await received?.({
      sessionKey: { channel: 'test', type: 'private', chatId: '1' },
      content: 'hi',
    });

    expect(channel.init).toHaveBeenCalledOnce();
    expect(pipeline.receiveWithSend).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ content: 'pipeline response' }]);
    expect(manager.getLoaded('test')).toBeDefined();
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
    const manager = new ChannelManager();
    manager.initialize({
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
    const channel = makeChannel();
    const manager = new ChannelManager();
    manager.initialize({
      configManager: new FakeConfigManager(),
      pipeline: makePipeline(),
      channels: [channel],
    });

    await manager.start('test');
    await manager.send({ channel: 'test', type: 'private', chatId: '1' }, { content: 'hello' });
    await manager.stopAll();

    expect(channel.send).toHaveBeenCalledWith(
      { channel: 'test', type: 'private', chatId: '1' },
      { content: 'hello' },
    );
    expect(channel.destroy).toHaveBeenCalledOnce();
    expect(manager.getLoaded('test')).toBeUndefined();
  });

  it('rejects duplicate channel registrations to avoid unsafe ownership cleanup', () => {
    const manager = new ChannelManager();
    const first = makeChannel({ name: 'duplicate' });
    const second = makeChannel({ name: 'duplicate' });

    manager.register(first);

    expect(() => manager.register(second)).toThrow(/already registered/);
    expect(manager.has('duplicate')).toBe(true);
  });
});
