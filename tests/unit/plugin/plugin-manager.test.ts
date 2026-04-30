import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';
import { PluginManager } from '../../../src/plugin/plugin-manager';
import type { PluginModule } from '../../../src/plugin/plugin-types';
import type { PluginConfigEntry } from '../../../src/core/config/schema';
import type { DeepPartial } from '../../../src/core/types';
import type { ChannelPlugin } from '../../../src/channel/channel-types';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { CommandRegistry } from '../../../src/command/command-registry';
import { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';

class FakeConfigManager {
  plugins: PluginConfigEntry[] = [];
  updates: Array<DeepPartial<{ plugins: PluginConfigEntry[] }>> = [];

  get(key: 'plugins'): Readonly<PluginConfigEntry[]> {
    if (key !== 'plugins') {
      throw new Error('Unsupported key');
    }
    return this.plugins;
  }

  async update(partial: DeepPartial<{ plugins: PluginConfigEntry[] }>): Promise<void> {
    this.updates.push(partial);
    if (partial.plugins) {
      this.plugins = partial.plugins.map((entry) => ({
        name: entry.name ?? '',
        enabled: entry.enabled ?? true,
        ...(entry.options === undefined ? {} : { options: entry.options }),
      }));
    }
  }
}

class FakePluginLoader {
  constructor(private readonly modules: Map<string, PluginModule>) {}

  async discover(): Promise<string[]> {
    return [...this.modules.keys()];
  }

  async load(pluginDir: string): Promise<PluginModule> {
    const module = this.modules.get(pluginDir);
    if (!module) {
      throw new Error(`Missing fixture for ${pluginDir}`);
    }
    return module;
  }
}

class FakeChannelManager {
  registered = new Map<string, ChannelPlugin>();
  unregistered: string[] = [];

  register(channel: ChannelPlugin): void {
    if (this.registered.has(channel.name)) {
      throw new Error(`Channel "${channel.name}" is already registered`);
    }
    this.registered.set(channel.name, channel);
  }

  async unregister(channelName: string): Promise<void> {
    this.unregistered.push(channelName);
    this.registered.delete(channelName);
  }

  has(channelName: string): boolean {
    return this.registered.has(channelName);
  }
}

function makeModule(overrides: Partial<PluginModule> = {}): PluginModule {
  const directory = overrides.directory ?? '/extensions/plugin_alpha';
  const directoryName = overrides.directoryName ?? 'plugin_alpha';
  return {
    directory,
    directoryName,
    entryPath: `${directory}/index.js`,
    definition: {
      name: 'alpha',
      version: '1.0.0',
      defaultConfig: { greeting: 'hello' },
      init: async (ctx) => {
        ctx.registerTool({
          name: 'alpha_tool',
          description: 'Alpha tool',
          parameters: Type.Object({}),
          owner: 'system',
          execute: async () => ({ content: String(ctx.config.greeting) }),
        });
        ctx.registerCommand({
          name: 'alpha',
          description: 'Alpha command',
          scope: 'system',
          execute: async () => 'ok',
        });
      },
      hooks: {
        async onReceive() {
          return { action: 'continue' };
        },
      },
    },
    ...overrides,
  };
}

function makeManager(module: PluginModule, config = new FakeConfigManager()) {
  const toolRegistry = new ToolRegistry();
  const commandRegistry = new CommandRegistry();
  const hookDispatcher = new HookDispatcher();
  const channelManager = new FakeChannelManager();
  const pluginLoader = new FakePluginLoader(new Map([[module.directory, module]]));
  const manager = new PluginManager({
    configManager: config,
    toolRegistry,
    commandRegistry,
    hookDispatcher,
    channelManager,
    pluginLoader,
  });
  return { manager, config, toolRegistry, commandRegistry, hookDispatcher, channelManager };
}

describe('PluginManager', () => {
  it('loads enabled plugins and scopes registered tools and commands', async () => {
    const module = makeModule();
    const { manager, toolRegistry, commandRegistry } = makeManager(module);

    await manager.loadAll();

    expect(toolRegistry.get('alpha_tool')?.owner).toBe('plugin:alpha');
    expect(commandRegistry.getAll()[0]?.scope).toBe('plugin:alpha');
    expect(manager.getLoaded('alpha')).toBeDefined();
  });

  it('deep merges plugin options over default config', async () => {
    const seenConfig: Record<string, unknown>[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        defaultConfig: {
          nested: {
            keep: 'default',
            override: 'default',
          },
          list: ['default'],
        },
        init: async (ctx) => {
          seenConfig.push(ctx.config);
        },
      },
    });
    const config = new FakeConfigManager();
    config.plugins = [
      {
        name: 'alpha',
        enabled: true,
        options: {
          nested: {
            override: 'configured',
          },
          list: ['configured'],
        },
      },
    ];
    const { manager } = makeManager(module, config);

    const loaded = await manager.load(module.directory);

    expect(seenConfig[0]).toEqual({
      nested: {
        keep: 'default',
        override: 'configured',
      },
      list: ['configured'],
    });
    expect(loaded.config).toEqual(seenConfig[0]);
  });

  it('prevents plugin context from unregistering tools owned by other scopes', async () => {
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: async (ctx) => {
          ctx.unregisterTool('system_tool');
          ctx.registerTool({
            name: 'alpha_tool',
            description: 'Alpha tool',
            parameters: Type.Object({}),
            owner: 'system',
            execute: async () => ({ content: 'ok' }),
          });
          ctx.unregisterTool('alpha_tool');
        },
      },
    });
    const { manager, toolRegistry } = makeManager(module);
    toolRegistry.register({
      name: 'system_tool',
      description: 'System tool',
      parameters: Type.Object({}),
      owner: 'system',
      execute: async () => ({ content: 'system' }),
    });

    await manager.load(module.directory);

    expect(toolRegistry.get('system_tool')?.owner).toBe('system');
    expect(toolRegistry.has('alpha_tool')).toBe(false);
  });

  it('unloads plugin resources by owner and unregisters hooks', async () => {
    const destroy = vi.fn(async () => undefined);
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        destroy,
      },
    });
    const { manager, toolRegistry, commandRegistry, hookDispatcher } = makeManager(module);

    await manager.load(module.directory);
    await manager.unload('alpha');

    expect(destroy).toHaveBeenCalledOnce();
    expect(toolRegistry.has('alpha_tool')).toBe(false);
    expect(commandRegistry.getAll()).toHaveLength(0);
    await expect(
      hookDispatcher.dispatchOnReceive({
        sessionKey: { channel: 'test', type: 'private', chatId: '1' },
        content: 'hi',
      }),
    ).resolves.toEqual({ action: 'continue' });
  });

  it('registers plugin channels and unregisters them during unload', async () => {
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: async (ctx) => {
          ctx.registerChannel({
            name: 'alpha_channel',
            version: '1.0.0',
            init: async () => undefined,
          });
        },
      },
    });
    const { manager, channelManager } = makeManager(module);

    await manager.load(module.directory);
    expect(channelManager.registered.has('alpha_channel')).toBe(true);

    await manager.unload('alpha');

    expect(channelManager.registered.has('alpha_channel')).toBe(false);
    expect(channelManager.unregistered).toEqual(['alpha_channel']);
  });

  it('rejects duplicate plugin channel names without unregistering the existing channel', async () => {
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: async (ctx) => {
          ctx.registerChannel({
            name: 'existing_channel',
            version: '1.0.0',
            init: async () => undefined,
          });
        },
      },
    });
    const { manager, channelManager } = makeManager(module);
    const existingChannel = {
      name: 'existing_channel',
      version: '1.0.0',
      init: async () => undefined,
    } satisfies ChannelPlugin;
    channelManager.register(existingChannel);

    await expect(manager.load(module.directory)).rejects.toThrow(/already registered/);

    expect(channelManager.registered.get('existing_channel')).toBe(existingChannel);
    expect(channelManager.unregistered).toEqual([]);
  });

  it('updates config for enable and disable', async () => {
    const module = makeModule();
    const { manager, config } = makeManager(module);

    await manager.disable('alpha');
    expect(config.plugins).toEqual([{ name: 'alpha', enabled: false }]);

    await manager.enable('alpha');
    expect(config.plugins).toEqual([{ name: 'alpha', enabled: true }]);
  });

  it('updates existing plugin directory aliases instead of appending conflicting entries', async () => {
    const module = makeModule();
    const config = new FakeConfigManager();
    config.plugins = [{ name: 'plugin_alpha', enabled: false }];
    const { manager } = makeManager(module, config);

    await manager.enable('alpha');

    expect(config.plugins).toEqual([{ name: 'plugin_alpha', enabled: true }]);
  });

  it('lists plugins disabled by plugin definition name', async () => {
    const module = makeModule();
    const config = new FakeConfigManager();
    config.plugins = [{ name: 'alpha', enabled: false }];
    const { manager } = makeManager(module, config);

    const statuses = await manager.listPlugins();

    expect(statuses).toEqual([
      expect.objectContaining({
        name: 'alpha',
        directoryName: 'plugin_alpha',
        enabled: false,
        state: 'disabled',
      }),
    ]);
  });

  it('returns null when loading a disabled plugin directly', async () => {
    const module = makeModule();
    const config = new FakeConfigManager();
    config.plugins = [{ name: 'alpha', enabled: false }];
    const { manager, toolRegistry } = makeManager(module, config);

    await expect(manager.load(module.directory)).resolves.toBeNull();

    expect(toolRegistry.get('alpha_tool')).toBeUndefined();
    expect(manager.getLoaded('alpha')).toBeUndefined();
  });

  it('isolates plugin init failures during loadAll', async () => {
    const badModule = makeModule({
      definition: {
        name: 'bad',
        version: '1.0.0',
        init: async () => {
          throw new Error('boom');
        },
      },
    });
    const goodModule = makeModule({
      directory: '/extensions/plugin_good',
      directoryName: 'plugin_good',
      definition: {
        ...makeModule().definition,
        name: 'good',
      },
    });
    const config = new FakeConfigManager();
    const toolRegistry = new ToolRegistry();
    const commandRegistry = new CommandRegistry();
    const hookDispatcher = new HookDispatcher();
    const pluginLoader = new FakePluginLoader(
      new Map([
        [badModule.directory, badModule],
        [goodModule.directory, goodModule],
      ]),
    );
    const manager = new PluginManager({
      configManager: config,
      toolRegistry,
      commandRegistry,
      hookDispatcher,
      channelManager: new FakeChannelManager(),
      pluginLoader,
    });

    await expect(manager.loadAll()).resolves.toBeUndefined();

    expect(manager.getLoaded('good')).toBeDefined();
    expect(manager.getLoaded('bad')).toBeUndefined();
  });

  it('coalesces overlapping config reload requests into a follow-up reload pass', async () => {
    const module = makeModule();
    const { manager } = makeManager(module);
    let releaseFirstUnload: (() => void) | null = null;
    const unloadAll = vi
      .spyOn(manager, 'unloadAll')
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseFirstUnload = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const loadAll = vi.spyOn(manager, 'loadAll').mockResolvedValue(undefined);

    const firstReload = manager.handleConfigReload();
    await Promise.resolve();
    const secondReload = manager.handleConfigReload();
    releaseFirstUnload?.();

    await Promise.all([firstReload, secondReload]);

    expect(unloadAll).toHaveBeenCalledTimes(2);
    expect(loadAll).toHaveBeenCalledTimes(2);
  });
});
