import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PluginManager } from '../../../src/extension/plugin/plugin-manager';
import type { PluginModule } from '../../../src/extension/plugin/plugin-types';
import type { ChannelPlugin } from '../../../src/extension/channel/channel-types';
import type { PluginConfigEntry } from '../../../src/core/config/schema';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { CommandRegistry } from '../../../src/command/command-registry';
import { HookDispatcher } from '../../../src/pipeline/hook-dispatcher';
import * as extensionLoader from '../../../src/extension/extension-loader';
import type { AesyClawTool } from '../../../src/tool/tool-registry';
import type { ChannelManager } from '../../../src/extension/channel/channel-manager';

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
  plugins: PluginConfigEntry[] = [];
  updates: Array<PluginConfigEntry[]> = [];

  get(path: 'plugins'): Readonly<PluginConfigEntry[]> {
    if (path !== 'plugins') {
      throw new Error('Unsupported key');
    }
    return this.plugins;
  }

  async set(path: 'plugins', value: PluginConfigEntry[]): Promise<void> {
    if (path === 'plugins') {
      this.updates.push(value);
      this.plugins = value.map((entry) => ({
        name: entry.name ?? '',
        enabled: entry.enabled ?? true,
        ...(entry.options === undefined ? {} : { options: entry.options }),
      }));
    }
  }
}

class FakeChannelManager {
  registeredChannels: Array<{ channel: ChannelPlugin; owner: string }> = [];
  ownersToUnregister: string[] = [];

  register(channel: ChannelPlugin, owner: string): void {
    this.registeredChannels.push({ channel, owner });
  }

  async unregisterByOwner(owner: string): Promise<void> {
    this.ownersToUnregister.push(owner);
  }
}

function makeModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    definition: {
      name: 'alpha',
      version: '0.1.0',
      description: 'Test plugin',
      init: vi.fn(async (ctx) => {
        ctx.registerTool({
          name: 'alpha_tool',
          description: 'An example tool',
          parameters: Type.Object({}),
          execute: async () => ({ content: 'ok' }),
        } as AesyClawTool);
        ctx.registerCommand({
          name: 'alpha_cmd',
          description: 'Example command',
          scope: 'plugin:alpha',
          execute: async () => 'ok',
        });
      }),
      ...overrides,
    },
    directory: '/tmp/plugins/plugin_alpha',
    directoryName: 'plugin_alpha',
    entryPath: '/tmp/plugins/plugin_alpha/index.ts',
    ...overrides,
  } as PluginModule;
}

function setupLoaderMock(module: PluginModule) {
  vi.spyOn(extensionLoader, 'discoverExtensionDirs').mockResolvedValue([module.directory]);
  vi.spyOn(extensionLoader, 'loadExtensionModule').mockImplementation(async (dir) => {
    if (dir !== module.directory) throw new Error('Module not found');
    return module;
  });
}

async function makeManager(module: PluginModule, config = new FakeConfigManager()) {
  const toolRegistry = new ToolRegistry();
  const commandRegistry = new CommandRegistry();
  const hookRegistry = new HookDispatcher();
  const channelManager = new FakeChannelManager();

  setupLoaderMock(module);

  const manager = new PluginManager({
    configManager: config,
    toolRegistry,
    commandRegistry,
    hookRegistry,
    channelManager: channelManager as unknown as ChannelManager,
    paths: fakePaths,
  });
  return { manager, config, toolRegistry, commandRegistry, hookRegistry, channelManager };
}

describe('PluginManager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads enabled plugins and scopes registered tools and commands', async () => {
    const module = makeModule();
    const { manager, toolRegistry, commandRegistry } = await makeManager(module);

    await manager.setup();

    expect(toolRegistry.get('alpha_tool')?.owner).toBe('plugin:alpha');
    expect(commandRegistry.getAll()[0]?.scope).toBe('plugin:alpha');
    expect(manager.getLoaded('alpha')).toBeDefined();
  });

  it('provides host paths to plugin init contexts', async () => {
    const seenPaths: unknown[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: vi.fn(async (ctx) => {
          seenPaths.push(ctx.paths);
        }),
      },
    });
    const { manager } = await makeManager(module);

    await manager.setup();

    expect(seenPaths).toEqual([fakePaths]);
  });

  it('discovers plugins from injected host extension paths', async () => {
    const module = makeModule();
    const { manager } = await makeManager(module);

    await manager.setup();

    expect(extensionLoader.discoverExtensionDirs).toHaveBeenCalledWith(
      expect.objectContaining({ extensionsDir: fakePaths.extensionsDir }),
    );
  });

  it('deep merges plugin options over default config', async () => {
    const seenConfig: Record<string, unknown>[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        defaultConfig: {
          nested: { keep: 'default', override: 'default' },
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
          nested: { override: 'configured' },
          list: ['configured'],
        },
      },
    ];

    const { manager } = await makeManager(module, config);
    await manager.setup();

    expect(seenConfig).toEqual([
      {
        nested: { keep: 'default', override: 'configured' },
        list: ['configured'],
      },
    ]);
  });

  it('skips disabled plugins', async () => {
    const module = makeModule();
    const config = new FakeConfigManager();
    config.plugins = [{ name: 'alpha', enabled: false }];

    const { manager } = await makeManager(module, config);
    await manager.setup();

    expect(manager.getLoaded('alpha')).toBeUndefined();
  });

  it('handles enable/disable toggling', async () => {
    const module = makeModule();
    const { manager } = await makeManager(module);

    await manager.disable('alpha');
    expect(manager.getLoaded('alpha')).toBeUndefined();

    await manager.enable('alpha');
    expect(manager.getLoaded('alpha')).toBeDefined();
  });

  it('unloads and reloads on config reload', async () => {
    const module = makeModule();
    const { manager } = await makeManager(module);
    await manager.setup();
    expect(manager.getLoaded('alpha')).toBeDefined();

    await manager.handleConfigReload();
    expect(manager.getLoaded('alpha')).toBeDefined();
  });

  it('isolates plugin init failures during setup', async () => {
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: vi.fn(async () => {
          throw new Error('explosion');
        }),
      },
    });

    const { manager } = await makeManager(module);
    await expect(manager.setup()).resolves.toBeUndefined();
    expect(manager.getLoaded('alpha')).toBeUndefined();
  });

  it('coalesces overlapping config reload requests', async () => {
    const module = makeModule();
    setupLoaderMock(module);

    const manager = new PluginManager({
      configManager: new FakeConfigManager(),
      toolRegistry: new ToolRegistry(),
      commandRegistry: new CommandRegistry(),
      hookRegistry: new HookDispatcher(),
      paths: fakePaths,
    });

    const unloadAll = vi.spyOn(manager, 'unloadAll').mockResolvedValue(undefined);
    const setupSpy = vi.spyOn(manager, 'setup').mockResolvedValue(undefined);

    const firstReload = manager.handleConfigReload();
    await Promise.resolve();
    const secondReload = manager.handleConfigReload();

    await Promise.all([firstReload, secondReload]);

    expect(unloadAll).toHaveBeenCalledTimes(2);
    expect(setupSpy).toHaveBeenCalledTimes(2);
  });
});
