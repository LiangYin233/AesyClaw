/** 插件管理器 — 加载、卸载并跟踪插件生命周期。 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage, isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import { stripEnabledField } from '@aesyclaw/extension/extension-utils';
import type { CommandDefinition } from '@aesyclaw/core/types';

import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import { loadExtensionModule, type ExtensionLifecycle } from '@aesyclaw/extension/extension-loader';
import {
  discoverPluginDefinition,
  pluginOwner,
  type LoadedPlugin,
  type PluginConfigLookup,
  type PluginContext,
  type PluginLifecycleState,
  type PluginManagerDependencies,
  type PluginModule,
  type PluginStatus,
} from './plugin-types';
import { PluginDiscovery } from './plugin-discovery';

const logger = createScopedLogger('plugin-manager');

/**
 * 插件管理器 — 负责插件的发现、加载、卸载、启用/禁用及配置热重载。
 */
export class PluginManager implements ExtensionLifecycle {
  private readonly loadedPlugins = new Map<string, LoadedPlugin>();
  readonly failedPlugins = new Map<string, string>();
  private readonly discovery: PluginDiscovery;
  /** 可热更新的配置引用：pluginName → { current } */
  private readonly configRefs = new Map<string, { current: Record<string, unknown> }>();

  constructor(private readonly deps: PluginManagerDependencies) {
    this.discovery = new PluginDiscovery(
      { paths: { extensionsDir: deps.paths.extensionsDir } },
      this.failedPlugins,
    );
  }

  // ─── ExtensionLifecycle ──────────────────────────────────────────

  /** 发现并加载所有已启用的插件。 */
  async setup(): Promise<void> {
    const pluginDirs = await this.discovery.discoverPluginDirs();
    for (const pluginDir of pluginDirs) {
      const directoryName = path.basename(pluginDir);
      if (!this.isDirectoryEnabled(directoryName)) {
        logger.info('跳过已禁用的插件目录', { directoryName });
        continue;
      }

      try {
        await this.load(pluginDir);
      } catch (err) {
        this.failedPlugins.set(directoryName, errorMessage(err));
        logger.error(`插件 "${directoryName}" 加载失败`, err);
      }
    }
  }

  /** 卸载所有已加载的插件。 */
  async destroy(): Promise<void> {
    await this.unloadAll();
  }

  // ─── 加载 / 卸载 ─────────────────────────────────────────────────

  async load(pluginDir: string): Promise<LoadedPlugin | null> {
    const module = await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
    const pluginName = module.definition.name;

    if (this.loadedPlugins.has(pluginName)) {
      await this.unload(pluginName);
    }

    const configLookup = this.getPluginConfig(module);
    const mergedConfig = getManagedPluginOptions(
      module.definition.defaultConfig,
      configLookup.config,
    );
    if (!configLookup.enabled) {
      logger.info('跳过已禁用的插件', { pluginName });
      return null;
    }

    const owner = pluginOwner(pluginName);
    const ref: { current: Record<string, unknown> } = { current: mergedConfig };
    this.configRefs.set(pluginName, ref);
    const context = this.createPluginContext(pluginName, ref);

    try {
      await module.definition.init(context);
      if (module.definition.middlewares) {
        for (const reg of module.definition.middlewares) {
          this.deps.hooksBus.register({
            ...reg,
            id: `plugin:${pluginName}:${reg.id}`,
          });
        }
      }
    } catch (err) {
      this.configRefs.delete(pluginName);
      await this.cleanupOwner(pluginName);
      this.failedPlugins.set(pluginName, errorMessage(err));
      throw err;
    }

    const loaded: LoadedPlugin = {
      definition: module.definition,
      directory: module.directory,
      directoryName: module.directoryName,
      owner,
      config: ref.current,
      loadedAt: new Date(),
    };
    this.loadedPlugins.set(pluginName, loaded);
    this.failedPlugins.delete(pluginName);
    this.failedPlugins.delete(module.directoryName);

    // 如果不存在，自动写入插件配置条目
    if (!configLookup.exists) {
      const plugins = this.getPluginRecord();
      plugins[pluginName] = {
        enabled: true,
        ...stripEnabledField(module.definition.defaultConfig ?? {}),
      };
      await this.deps.configManager.set('plugins', plugins).catch((err: unknown) => {
        logger.warn(`自动写入插件 "${pluginName}" 的配置条目失败`, err);
      });
    }

    logger.info('插件已加载', { pluginName, directoryName: module.directoryName });
    return loaded;
  }

  /** 按逆序卸载所有已加载的插件。 */
  async unloadAll(): Promise<void> {
    const names = [...this.loadedPlugins.keys()].reverse();
    for (const pluginName of names) {
      try {
        await this.unload(pluginName);
      } catch (err) {
        logger.error(`插件 "${pluginName}" 卸载失败`, err);
      }
    }
    logger.info('所有插件已卸载');
  }

  // ─── 运行时控制 ─────────────────────────────────────────────────

  async enable(pluginName: string): Promise<void> {
    await this.setPluginEnabled(pluginName, true);
    const match = await this.discovery.findPlugin(pluginName, this.loadedPlugins);
    if (match && !this.loadedPlugins.has(match.definition.name)) {
      try {
        await this.load(match.directory);
      } catch (err) {
        logger.error(`启用后插件 "${pluginName}" 加载失败`, err);
      }
    }
  }

  async disable(pluginName: string): Promise<void> {
    await this.unload(pluginName);
    await this.setPluginEnabled(pluginName, false);
  }

  /** 热重载：配置变更时重启对应插件，加载新增插件，卸载禁用的插件。 */
  async handleConfigReload(): Promise<void> {
    const record = this.getPluginRecord();

    // Phase 1: 已加载的插件 — 配置变更则重启
    for (const [pluginName, loaded] of [...this.loadedPlugins]) {
      const raw = record[pluginName] ?? record[loaded.directoryName];
      const entry = isRecord(raw) ? raw : null;
      if (!entry || entry['enabled'] === false) {
        await this.unload(pluginName);
        continue;
      }

      const freshConfig = getManagedPluginOptions(
        loaded.definition.defaultConfig,
        stripEnabledField(entry),
      );

      if (JSON.stringify(loaded.config) === JSON.stringify(freshConfig)) continue;

      const directory = loaded.directory;
      logger.info(`插件 "${pluginName}" 配置已变更，正在重启`);
      await this.unload(pluginName);
      try {
        await this.load(directory);
      } catch (err) {
        logger.error(`热重载时重启插件 "${pluginName}" 失败`, err);
      }
    }

    // Phase 2: 新增/启用的插件 — 加载
    for (const [name, raw] of Object.entries(record)) {
      if (!isRecord(raw) || raw['enabled'] === false) continue;
      if (this.loadedPlugins.has(name)) continue;

      const match = await this.discovery.findPlugin(name, this.loadedPlugins);
      if (match) {
        try {
          await this.load(match.directory);
        } catch (err) {
          logger.error(`热重载时加载插件 "${name}" 失败`, err);
        }
      }
    }
  }

  // ─── 查询 ────────────────────────────────────────────────────────

  async listPlugins(): Promise<PluginStatus[]> {
    const statuses = new Map<string, PluginStatus>();
    for (const loaded of this.loadedPlugins.values()) {
      statuses.set(loaded.directoryName, {
        name: loaded.definition.name,
        directoryName: loaded.directoryName,
        version: loaded.definition.version,
        description: loaded.definition.description,
        enabled: true,
        state: 'loaded',
        directory: loaded.directory,
      });
    }

    const discovered = await this.discovery.discoverPluginDirs();
    for (const pluginDir of discovered) {
      const directoryName = path.basename(pluginDir);
      if (statuses.has(directoryName)) continue;

      const module = await this.discovery.safeLoadModule(pluginDir);
      const configLookup = module ? this.getPluginConfig(module) : null;
      const enabled = configLookup?.enabled ?? this.isDirectoryEnabled(directoryName);
      const name = module?.definition.name ?? directoryName;
      const error = this.failedPlugins.get(name) ?? this.failedPlugins.get(directoryName);
      statuses.set(directoryName, {
        name,
        directoryName,
        version: module?.definition.version,
        description: module?.definition.description,
        enabled,
        state: resolvePluginState(error, enabled),
        directory: pluginDir,
        error,
      });
    }

    return [...statuses.values()].sort((a, b) => a.directoryName.localeCompare(b.directoryName));
  }

  /** 获取所有已发现插件的定义信息 */
  async getPluginDefinitions() {
    return await this.discovery.getPluginDefinitions();
  }

  getLoaded(pluginName: string): LoadedPlugin | undefined {
    return this.findLoadedPlugin(pluginName);
  }

  // ─── 内部方法 ────────────────────────────────────────────────────

  private async unload(pluginName: string): Promise<void> {
    const loaded = this.findLoadedPlugin(pluginName);
    if (!loaded) return;

    const actualName = loaded.definition.name;
    try {
      if (loaded.definition.destroy) {
        await loaded.definition.destroy();
      }
    } finally {
      this.configRefs.delete(actualName);
      await this.cleanupOwner(actualName);
      this.loadedPlugins.delete(actualName);
      logger.info('插件已卸载', { pluginName: actualName });
    }
  }

  private createPluginContext(
    pluginName: string,
    ref: { current: Record<string, unknown> },
  ): PluginContext {
    const owner = pluginOwner(pluginName);
    const deps = this.deps;
    return {
      get config() {
        return ref.current;
      },
      paths: deps.paths,
      registerTool: (tool: AesyClawTool): void => {
        deps.toolRegistry.register({ ...tool, owner });
      },
      unregisterTool: (name: string): void => {
        const existing = deps.toolRegistry.get(name);
        if (!existing) return;
        if (existing.owner !== owner) {
          logger.warn('插件尝试注销一个不属于自己的工具', {
            pluginName,
            toolName: name,
            owner: existing.owner,
          });
          return;
        }
        deps.toolRegistry.unregister(name);
      },
      registerCommand: (command: CommandDefinition): void => {
        deps.commandRegistry.register({ ...command, scope: owner });
      },
      registerChannel: (channel): void => {
        if (!deps.channelManager) {
          throw new Error('ChannelManager 对插件不可用');
        }
        deps.channelManager.register(channel, owner);
      },
      logger: createScopedLogger(owner),
      resolveModel: (providerModel) => deps.llmAdapter.resolveModel(providerModel),
    };
  }

  private async cleanupOwner(pluginName: string): Promise<void> {
    const owner = pluginOwner(pluginName);
    this.deps.hooksBus.unregisterByPrefix(`plugin:${pluginName}:`);
    this.deps.toolRegistry.unregisterByOwner(owner);
    this.deps.commandRegistry.unregisterByScope(owner);
    await this.deps.channelManager?.unregisterByOwner(owner);
  }

  private findLoadedPlugin(nameOrAlias: string): LoadedPlugin | undefined {
    const direct = this.loadedPlugins.get(nameOrAlias);
    if (direct) return direct;
    return [...this.loadedPlugins.values()].find((plugin) => plugin.directoryName === nameOrAlias);
  }

  private getPluginConfig(module: PluginModule): PluginConfigLookup {
    const plugins = this.getPluginRecord();
    const raw = plugins[module.definition.name] ?? plugins[module.directoryName];
    const entry = isRecord(raw) ? raw : null;
    return {
      exists: entry !== null,
      enabled: entry?.['enabled'] !== false,
      config: entry ? stripEnabledField(entry) : {},
    };
  }

  private isDirectoryEnabled(directoryName: string): boolean {
    const raw = this.getPluginRecord()[directoryName];
    const entry = isRecord(raw) ? raw : null;
    return entry?.['enabled'] !== false;
  }

  private getPluginRecord(): Record<string, unknown> {
    try {
      const plugins = this.deps.configManager.get('plugins');
      return isRecord(plugins) ? plugins : {};
    } catch (err) {
      logger.error('读取插件配置失败', err);
      return {};
    }
  }

  private async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
    const match = await this.discovery.findPlugin(pluginName, this.loadedPlugins);
    const canonicalName = match?.definition.name ?? pluginName;
    const plugins = this.getPluginRecord();

    const existing: Record<string, unknown> | undefined =
      (plugins[canonicalName] ?? plugins[match?.directoryName ?? '']) as Record<string, unknown> | undefined;
    if (existing) {
      existing['enabled'] = enabled;
    } else {
      plugins[canonicalName] = { enabled } as Record<string, unknown>;
    }

    await this.deps.configManager.set('plugins', plugins);
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────

function getManagedPluginOptions(
  defaults: Record<string, unknown> | undefined,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return stripEnabledField(mergeDefaults(stripEnabledField(defaults ?? {}), overrides));
}



/** 根据错误状态和启用状态解析插件状态字符串 */
function resolvePluginState(error: string | undefined, enabled: boolean): PluginLifecycleState {
  if (error) return 'failed';
  if (enabled) return 'unloaded';
  return 'disabled';
}
