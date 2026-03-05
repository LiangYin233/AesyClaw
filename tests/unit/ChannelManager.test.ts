import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelManager, type ChannelPlugin } from '../../src/channels/ChannelManager';
import { EventBus } from '../../src/bus/EventBus';
import type { BaseChannel } from '../../src/channels/BaseChannel';

describe('ChannelManager', () => {
  let eventBus: EventBus;
  let channelManager: ChannelManager;

  beforeEach(() => {
    eventBus = new EventBus();
    channelManager = new ChannelManager(eventBus);
  });

  describe('Channel plugin registration', () => {
    it('should register a channel plugin', () => {
      const plugin: ChannelPlugin = {
        name: 'test-channel',
        create: vi.fn()
      };

      ChannelManager.registerPlugin(plugin);
      const retrieved = channelManager.getPlugin('test-channel');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('test-channel');
    });

    it('should list all registered plugins', () => {
      const plugin1: ChannelPlugin = { name: 'plugin1', create: vi.fn() };
      const plugin2: ChannelPlugin = { name: 'plugin2', create: vi.fn() };

      ChannelManager.registerPlugin(plugin1);
      ChannelManager.registerPlugin(plugin2);

      const plugins = channelManager.listPlugins();
      expect(plugins).toContain('plugin1');
      expect(plugins).toContain('plugin2');
    });

    it('should unregister a plugin', () => {
      const plugin: ChannelPlugin = { name: 'unreg-test', create: vi.fn() };
      ChannelManager.registerPlugin(plugin);
      channelManager.unregisterPlugin('unreg-test');

      expect(channelManager.getPlugin('unreg-test')).toBeUndefined();
    });
  });

  describe('Channel creation', () => {
    it('should create a channel from plugin', () => {
      const mockChannel: BaseChannel = {
        name: 'mock-channel',
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
        isRunning: vi.fn().mockReturnValue(true)
      } as unknown as BaseChannel;

      const plugin: ChannelPlugin = {
        name: 'create-test',
        create: vi.fn().mockReturnValue(mockChannel)
      };

      ChannelManager.registerPlugin(plugin);
      const channel = channelManager.createChannel('create-test', { test: true });

      expect(channel).toBeDefined();
      expect(channel?.name).toBe('mock-channel');
    });

    it('should return null for non-existent plugin', () => {
      const channel = channelManager.createChannel('non-existent', {});
      expect(channel).toBeNull();
    });
  });

  describe('Channel management', () => {
    it('should register an existing channel', () => {
      const mockChannel: BaseChannel = {
        name: 'manual-channel',
        start: vi.fn(),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn().mockReturnValue(false)
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);
      const retrieved = channelManager.get('manual-channel');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('manual-channel');
    });

    it('should unregister a channel', () => {
      const mockChannel: BaseChannel = {
        name: 'unreg-channel',
        start: vi.fn(),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn()
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);
      channelManager.unregister('unreg-channel');

      expect(channelManager.get('unreg-channel')).toBeUndefined();
    });

    it('should get enabled channels', () => {
      const mockChannel1: BaseChannel = {
        name: 'channel1',
        start: vi.fn(),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn()
      } as unknown as BaseChannel;

      const mockChannel2: BaseChannel = {
        name: 'channel2',
        start: vi.fn(),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn()
      } as unknown as BaseChannel;

      channelManager.register(mockChannel1);
      channelManager.register(mockChannel2);

      const enabled = channelManager.getEnabledChannels();
      expect(enabled).toHaveLength(2);
      expect(enabled).toContain('channel1');
      expect(enabled).toContain('channel2');
    });
  });

  describe('Channel lifecycle', () => {
    it('should start all channels', async () => {
      const mockChannel: BaseChannel = {
        name: 'startable-channel',
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn().mockReturnValue(true)
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);
      await channelManager.startAll();

      expect(mockChannel.start).toHaveBeenCalled();
    });

    it('should stop all channels', async () => {
      const mockChannel: BaseChannel = {
        name: 'stoppable-channel',
        start: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
        isRunning: vi.fn().mockReturnValue(false)
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);
      await channelManager.stopAll();

      expect(mockChannel.stop).toHaveBeenCalled();
    });

    it('should handle start errors gracefully', async () => {
      const mockChannel: BaseChannel = {
        name: 'error-channel',
        start: vi.fn().mockRejectedValue(new Error('Start failed')),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn().mockReturnValue(false)
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);

      // Should not throw
      await expect(channelManager.startAll()).resolves.not.toThrow();
    });

    it('should get channel status', () => {
      const mockChannel: BaseChannel = {
        name: 'status-channel',
        start: vi.fn(),
        stop: vi.fn(),
        send: vi.fn(),
        isRunning: vi.fn().mockReturnValue(true)
      } as unknown as BaseChannel;

      channelManager.register(mockChannel);
      const status = channelManager.getStatus();

      expect(status['status-channel']).toBeDefined();
      expect(status['status-channel'].running).toBe(true);
    });
  });
});
