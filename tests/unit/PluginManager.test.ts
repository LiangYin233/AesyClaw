import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../src/bus/EventBus';
import { PluginManager, type Plugin, type PluginCommand } from '../../src/plugins/PluginManager';
import type { ToolRegistry } from '../../src/tools/ToolRegistry';

describe('PluginManager', () => {
  let eventBus: EventBus;
  let pluginManager: PluginManager;
  let mockToolRegistry: ToolRegistry;

  beforeEach(() => {
    eventBus = new EventBus();
    mockToolRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      clear: vi.fn()
    } as unknown as ToolRegistry;

    const mockContext = {
      config: {
        server: { host: 'localhost', port: 18791, apiPort: 18792 },
        agent: { defaults: { model: 'test', provider: 'test', maxToolIterations: 10, memoryWindow: 50, contextMode: 'session' as const } },
        channels: {},
        providers: {}
      },
      eventBus,
      agent: null,
      workspace: '/test'
    };

    pluginManager = new PluginManager(mockContext, mockToolRegistry);
  });

  describe('Plugin loading', () => {
    it('should load a plugin', async () => {
      const plugin: Plugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin',
        onLoad: vi.fn().mockResolvedValue(undefined)
      };

      await pluginManager.loadPlugin(plugin);
      const loaded = pluginManager.getPlugin('test-plugin');

      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('test-plugin');
      expect(plugin.onLoad).toHaveBeenCalled();
    });

    it('should not load duplicate plugins', async () => {
      const plugin: Plugin = {
        name: 'duplicate-plugin',
        version: '1.0.0'
      };

      await pluginManager.loadPlugin(plugin);
      await pluginManager.loadPlugin(plugin);

      const plugins = pluginManager.listPlugins();
      expect(plugins).toHaveLength(1);
    });

    it('should call onStart when loading plugin', async () => {
      const onStart = vi.fn().mockResolvedValue(undefined);
      const plugin: Plugin = {
        name: 'start-plugin',
        version: '1.0.0',
        onStart
      };

      await pluginManager.loadPlugin(plugin);
      expect(onStart).toHaveBeenCalled();
    });
  });

  describe('Plugin unloading', () => {
    it('should unload a plugin', async () => {
      const onStop = vi.fn().mockResolvedValue(undefined);
      const onUnload = vi.fn().mockResolvedValue(undefined);

      const plugin: Plugin = {
        name: 'unload-plugin',
        version: '1.0.0',
        onStop,
        onUnload
      };

      await pluginManager.loadPlugin(plugin);
      await pluginManager.unloadPlugin('unload-plugin');

      expect(pluginManager.getPlugin('unload-plugin')).toBeUndefined();
      expect(onStop).toHaveBeenCalled();
      expect(onUnload).toHaveBeenCalled();
    });
  });

  describe('Command matching', () => {
    it('should match exact commands', async () => {
      const handler = vi.fn().mockResolvedValue(null);
      const command: PluginCommand = {
        name: 'test',
        description: 'Test command',
        matcher: { type: 'exact', value: '/test' },
        handler
      };

      const plugin: Plugin = {
        name: 'cmd-plugin',
        version: '1.0.0',
        commands: [command]
      };

      await pluginManager.loadPlugin(plugin);

      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: '/test',
        timestamp: new Date()
      };

      await pluginManager.applyOnCommand(msg);
      expect(handler).toHaveBeenCalled();
    });

    it('should match prefix commands', async () => {
      const handler = vi.fn().mockResolvedValue(null);
      const command: PluginCommand = {
        name: 'prefix',
        description: 'Prefix command',
        matcher: { type: 'prefix', value: '/!' },
        handler
      };

      const plugin: Plugin = {
        name: 'prefix-plugin',
        version: '1.0.0',
        commands: [command]
      };

      await pluginManager.loadPlugin(plugin);

      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: '/!hello world',
        timestamp: new Date()
      };

      await pluginManager.applyOnCommand(msg);
      expect(handler).toHaveBeenCalled();
    });

    it('should match regex commands', async () => {
      const handler = vi.fn().mockResolvedValue(null);
      const command: PluginCommand = {
        name: 'regex',
        description: 'Regex command',
        matcher: { type: 'regex', value: /^\/echo (.+)$/ },
        handler
      };

      const plugin: Plugin = {
        name: 'regex-plugin',
        version: '1.0.0',
        commands: [command]
      };

      await pluginManager.loadPlugin(plugin);

      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: '/echo hello',
        timestamp: new Date()
      };

      await pluginManager.applyOnCommand(msg);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Message processing', () => {
    it('should process inbound messages through plugins', async () => {
      const onMessage = vi.fn().mockImplementation(async (msg) => {
        return { ...msg, content: 'modified' };
      });

      const plugin: Plugin = {
        name: 'message-plugin',
        version: '1.0.0',
        onMessage
      };

      await pluginManager.loadPlugin(plugin);

      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'original',
        timestamp: new Date()
      };

      const result = await pluginManager.applyOnMessage(msg);
      expect(onMessage).toHaveBeenCalled();
      expect(result.content).toBe('modified');
    });
  });

  describe('Response processing', () => {
    it('should process outbound messages through plugins', async () => {
      const onResponse = vi.fn().mockImplementation(async (msg) => {
        return { ...msg, content: 'processed' };
      });

      const plugin: Plugin = {
        name: 'response-plugin',
        version: '1.0.0',
        onResponse
      };

      await pluginManager.loadPlugin(plugin);

      const msg = {
        channel: 'test',
        chatId: 'chat1',
        content: 'original response'
      };

      const result = await pluginManager.applyOnResponse(msg);
      expect(onResponse).toHaveBeenCalled();
      expect(result.content).toBe('processed');
    });
  });
});
