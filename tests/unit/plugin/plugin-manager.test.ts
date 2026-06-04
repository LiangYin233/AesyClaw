import path from 'node:path';
import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PluginManager } from '../../../src/extension/plugin/manager';
import type { PluginModule } from '../../../src/extension/plugin/types';
import { RuntimeControlHub } from '../../../src/extension/plugin/control';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { CommandRegistry } from '../../../src/command/command-registry';
import { HooksBus } from '../../../src/hook';
import * as extensionLoader from '../../../src/extension/extension-loader';

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
};

class FakeConfigManager {
  plugins: Record<string, unknown> = {};

  get(path: string): unknown {
    if (path === 'plugins') return this.plugins;
    if (path === 'providers') return {};
    if (path.startsWith('plugins.')) {
      const parts = path.split('.').slice(1);
      let current: unknown = this.plugins;
      for (const part of parts) {
        if (current === null || typeof current !== 'object') return undefined;
        current = (current as Record<string, unknown>)[part];
      }
      return current;
    }
    throw new Error(`Unsupported key: ${path}`);
  }

  async set(path: string, value: unknown): Promise<void> {
    if (path === 'plugins') {
      this.plugins = { ...(value as Record<string, unknown>) };
      return;
    }
    const parts = path.split('.');
    if (parts[0] === 'plugins' && parts[1]) {
      const current = (this.plugins[parts[1]] ?? {}) as Record<string, unknown>;
      this.plugins[parts[1]] = { ...current, [parts.slice(2).join('.')]: value };
      return;
    }
    throw new Error(`Unsupported key: ${path}`);
  }
}

function makeModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    definition: {
      name: 'alpha',
      version: '0.1.0',
      description: 'Test plugin',
      init: vi.fn(async (ctx) => {
        ctx.registry.tools.register({
          name: 'alpha_tool',
          description: 'An example tool',
          parameters: Type.Object({}),
          execute: async () => ({ content: 'ok' }),
        });
        ctx.registry.commands.register({
          name: 'alpha_cmd',
          description: 'Example command',
          execute: async () => ({ components: [{ type: 'Plain', text: 'ok' }] }),
        });
      }),
      ...overrides.definition,
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
  const hooksBus = new HooksBus();
  const control = new RuntimeControlHub();

  setupLoaderMock(module);

  const manager = new PluginManager({
    configManager: config as never,
    toolRegistry,
    commandRegistry,
    hooksBus,
    paths: fakePaths,
    llmAdapter: { resolveModel: vi.fn() },
    control,
  });
  return { manager, config, toolRegistry, commandRegistry, hooksBus, control };
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

  it('provides namespaced paths to plugin init contexts', async () => {
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

    expect(seenPaths).toEqual([
      {
        runtimeRoot: fakePaths.runtimeRoot,
        dataDir: fakePaths.dataDir,
        mediaDir: fakePaths.mediaDir,
        workspaceDir: fakePaths.workspaceDir,
        pluginDir: path.join(fakePaths.dataDir, 'extensions', 'plugin_alpha'),
      },
    ]);
  });

  it('provides metadata and runtime control to plugin init contexts', async () => {
    const seen: unknown[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: vi.fn(async (ctx) => {
          seen.push({ meta: ctx.meta, control: ctx.control });
        }),
      },
    });
    const { manager, control } = await makeManager(module);

    await manager.setup();

    expect(seen).toEqual([
      {
        meta: { name: 'alpha', owner: 'plugin:alpha', directoryName: 'plugin_alpha' },
        control,
      },
    ]);
  });

  it('discovers plugins from injected host extension paths', async () => {
    const module = makeModule();
    const { manager } = await makeManager(module);

    await manager.setup();

    expect(extensionLoader.discoverExtensionDirs).toHaveBeenCalledWith(
      expect.objectContaining({ extensionsDir: fakePaths.extensionsDir }),
    );
  });

  it('exposes plugin config through ctx.config.self', async () => {
    const seenConfig: unknown[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        configSchema: Type.Object({
          nested: Type.Object({
            override: Type.String(),
          }),
          list: Type.Array(Type.String()),
        }),
        init: async (ctx) => {
          seenConfig.push({
            nested: ctx.config.self.get('nested'),
            list: ctx.config.self.get('list'),
            enabled: ctx.config.self.get('enabled'),
          });
        },
      },
    });
    const config = new FakeConfigManager();
    config.plugins = {
      alpha: {
        enabled: true,
        nested: { override: 'configured' },
        list: ['configured'],
      },
    };

    const { manager } = await makeManager(module, config);
    await manager.setup();

    expect(seenConfig).toEqual([
      {
        nested: { override: 'configured' },
        list: ['configured'],
        enabled: undefined,
      },
    ]);
  });

  it('enforces global config permissions', async () => {
    const denied: unknown[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        init: vi.fn(async (ctx) => {
          try {
            ctx.config.global.get('agent.defaultModel');
          } catch (err) {
            denied.push(err);
          }
        }),
      },
    });

    const { manager } = await makeManager(module);
    await manager.setup();

    expect(denied[0]).toMatchObject({
      name: 'PluginPermissionDeniedError',
      pluginName: 'alpha',
      permission: 'config.read',
      path: 'agent.defaultModel',
    });
  });

  it('allows declared global config paths only', async () => {
    const seen: unknown[] = [];
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        permissions: { config: { read: ['plugins.*.enabled'] } },
        init: vi.fn(async (ctx) => {
          seen.push(ctx.config.global.get('plugins.alpha.enabled'));
          expect(() => ctx.config.global.get('plugins.alpha.host')).toThrow();
        }),
      },
    });
    const config = new FakeConfigManager();
    config.plugins = { alpha: { enabled: true, host: '127.0.0.1' } };

    const { manager } = await makeManager(module, config);
    await manager.setup();

    expect(seen).toEqual([true]);
  });

  it('skips disabled plugins', async () => {
    const module = makeModule();
    const config = new FakeConfigManager();
    config.plugins = { alpha: { enabled: false } };

    const { manager } = await makeManager(module, config);
    await manager.setup();

    expect(manager.getLoaded('alpha')).toBeUndefined();
  });

  it('handles enable/disable toggling through manager compatibility methods', async () => {
    const module = makeModule({
      definition: {
        ...makeModule().definition,
        configSchema: Type.Object({ greeting: Type.String({ default: 'hello' }) }),
        init: vi.fn(async (ctx) => {
          expect(ctx.config.self.get('greeting')).toBe('hello');
        }),
      },
    });
    const { manager, config } = await makeManager(module);

    await manager.disable('alpha');
    expect(manager.getLoaded('alpha')).toBeUndefined();
    expect(config.plugins['alpha']).toMatchObject({ enabled: false });

    await manager.enable('alpha');
    expect(manager.getLoaded('alpha')).toBeDefined();
    expect(config.plugins['alpha']).toEqual({ enabled: true, greeting: 'hello' });
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
      configManager: new FakeConfigManager() as never,
      toolRegistry: new ToolRegistry(),
      commandRegistry: new CommandRegistry(),
      hooksBus: new HooksBus(),
      paths: fakePaths,
      llmAdapter: { resolveModel: vi.fn() },
      control: new RuntimeControlHub(),
    });

    const firstReload = manager.handleConfigReload();
    await Promise.resolve();
    const secondReload = manager.handleConfigReload();

    await expect(Promise.all([firstReload, secondReload])).resolves.toBeDefined();
  });
});
