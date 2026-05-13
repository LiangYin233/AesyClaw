/** 插件管理器 — 加载、卸载并跟踪插件生命周期。 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage, isRecord, mergeDefaults } from '@aesyclaw/core/utils';
import type { CommandDefinition } from '@aesyclaw/core/types';
import type { PluginConfigEntry } from '@aesyclaw/core/config/schema';
import type { AesyClawTool } from '@aesyclaw/tool/tool-registry';
import {
  discoverExtensionDirs,
  loadExtensionModule,
  type ExtensionLifecycle,
} from '@aesyclaw/extension/extension-loader';
import type {
  LoadedPlugin,
  PluginConfigLookup,
  PluginContext,
  PluginLifecycleState,
  PluginManagerDependencies,
  PluginModule,
  PluginStatus,
} from './plugin-types';
import { pluginOwner, discoverPluginDefinition } from './plugin-types';

const logger = createScopedLogger('plugin-manager');

/**
 * 插件管理器 — 负责插件的发现、加载、卸载、启用/禁用及配置热重载。
 *
 * @param deps - 插件管理器依赖项
 */
export class PluginManager implements ExtensionLifecycle {
  private readonly loadedPlugins = new Map<string, LoadedPlugin>();
  private readonly failedPlugins = new Map<string, string>();
  private readonly moduleCache = new Map<string, PluginModule | null>();

  constructor(private readonly deps: PluginManagerDependencies) {}

  private get extensionsDir(): string {
    return this.deps.paths.extensionsDir;
  }

  // ─── ExtensionLifecycle ──────────────────────────────────────────

  /** 发现并加载所有已启用的插件。 */
  async setup(): Promise<void> {
    const pluginDirs = await this.discoverPluginDirs();
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

  /**
   * 加载单个插件。
   *
   * @param pluginDir - 插件目录路径
   * @returns 加载成功返回 LoadedPlugin，插件被禁用则返回 null
   */
  async load(pluginDir: string): Promise<LoadedPlugin | null> {
    const module = await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
    const pluginName = module.definition.name;

    if (this.loadedPlugins.has(pluginName)) {
      await this.unload(pluginName);
    }

    const configLookup = this.getPluginConfig(module);
    const mergedConfig = mergeDefaults(module.definition.defaultConfig ?? {}, configLookup.options);
    if (!configLookup.enabled) {
      logger.info('跳过已禁用的插件', { pluginName });
      return null;
    }

    const owner = pluginOwner(pluginName);
    const context = this.createPluginContext(pluginName, mergedConfig);

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
      await this.cleanupOwner(pluginName);
      this.failedPlugins.set(pluginName, errorMessage(err));
      throw err;
    }

    const loaded: LoadedPlugin = {
      definition: module.definition,
      directory: module.directory,
      directoryName: module.directoryName,
      owner,
      config: mergedConfig,
      loadedAt: new Date(),
    };
    this.loadedPlugins.set(pluginName, loaded);
    this.failedPlugins.delete(pluginName);
    this.failedPlugins.delete(module.directoryName);

    // 如果不存在，自动写入插件配置条目
    if (!configLookup.entry) {
      const plugins = this.getConfigEntries().map((entry) => ({
        name: entry.name,
        enabled: entry.enabled,
        ...(entry.options === undefined ? {} : { options: optionsToRecord(entry.options) }),
      }));
      plugins.push({
        name: pluginName,
        enabled: true,
        ...(module.definition.defaultConfig ? { options: module.definition.defaultConfig } : {}),
      });
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

  /**
   * 启用指定插件（写入配置并加载）。
   *
   * @param pluginName - 插件名称或目录名
   */
  async enable(pluginName: string): Promise<void> {
    await this.setPluginEnabled(pluginName, true);
    const match = await this.findPlugin(pluginName);
    if (match && !this.loadedPlugins.has(match.definition.name)) {
      try {
        await this.load(match.directory);
      } catch (err) {
        logger.error(`启用后插件 "${pluginName}" 加载失败`, err);
      }
    }
  }

  /**
   * 禁用指定插件（卸载并写入配置）。
   *
   * @param pluginName - 插件名称或目录名
   */
  async disable(pluginName: string): Promise<void> {
    await this.unload(pluginName);
    await this.setPluginEnabled(pluginName, false);
  }

  /** 卸载全部插件并重新加载（配置热重载）。 */
  async handleConfigReload(): Promise<void> {
    await this.unloadAll();
    this.moduleCache.clear();
    await this.setup();
  }

  // ─── 查询 ────────────────────────────────────────────────────────

  /**
   * 列出所有插件的运行时状态。
   *
   * @returns 按目录名排序的插件状态列表
   */
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

    const discovered = await this.discoverPluginDirs();
    for (const pluginDir of discovered) {
      const directoryName = path.basename(pluginDir);
      if (statuses.has(directoryName)) {
        continue;
      }

      const module = await this.safeLoadModule(pluginDir);
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

  /**
   * 按名称或目录名查找插件模块。
   *
   * @param nameOrAlias - 插件名称或目录名
   * @returns 找到的模块，未找到返回 null
   */
  async findPlugin(nameOrAlias: string): Promise<PluginModule | null> {
    const loaded = this.findLoadedPlugin(nameOrAlias);
    if (loaded) {
      return {
        definition: loaded.definition,
        directory: loaded.directory,
        directoryName: loaded.directoryName,
        entryPath: '',
      };
    }

    const pluginDirs = await this.discoverPluginDirs();
    for (const pluginDir of pluginDirs) {
      const directoryName = path.basename(pluginDir);
      const module = await this.safeLoadModule(pluginDir);
      if (!module) {
        continue;
      }
      if (directoryName === nameOrAlias || module.definition.name === nameOrAlias) {
        return module;
      }
    }

    return null;
  }

  /**
   * 获取所有已发现插件的定义（名称、版本、描述、默认配置）。
   *
   * @returns 插件定义数组
   */
  async getPluginDefinitions(): Promise<
    Array<{
      name: string;
      version?: string;
      description?: string;
      defaultConfig?: Record<string, unknown>;
    }>
  > {
    const result = [];
    const discovered = await this.discoverPluginDirs();
    for (const dir of discovered) {
      const module = await this.safeLoadModule(dir);
      if (module) {
        result.push({
          name: module.definition.name,
          version: module.definition.version,
          description: module.definition.description,
          defaultConfig: module.definition.defaultConfig,
        });
      }
    }
    return result;
  }

  /**
   * 获取已加载插件的运行时实例。
   *
   * @param pluginName - 插件名称
   * @returns 已加载的插件，未找到返回 undefined
   */
  getLoaded(pluginName: string): LoadedPlugin | undefined {
    return this.findLoadedPlugin(pluginName);
  }

  // ─── 内部方法 ────────────────────────────────────────────────────

  private async unload(pluginName: string): Promise<void> {
    const loaded = this.findLoadedPlugin(pluginName);
    if (!loaded) {
      return;
    }

    const actualName = loaded.definition.name;
    try {
      if (loaded.definition.destroy) {
        await loaded.definition.destroy();
      }
    } finally {
      await this.cleanupOwner(actualName);
      this.loadedPlugins.delete(actualName);
      logger.info('插件已卸载', { pluginName: actualName });
    }
  }

  private async discoverPluginDirs(): Promise<string[]> {
    return await discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'plugin_',
      logger,
      unreadableMessage: '插件扩展目录不可读',
      inspectFailureMessage: '检查插件目录候选失败',
      candidateField: 'pluginDir',
    });
  }

  private async safeLoadModule(pluginDir: string): Promise<PluginModule | null> {
    if (this.moduleCache.has(pluginDir)) {
      return this.moduleCache.get(pluginDir) ?? null;
    }
    try {
      const module = await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
      this.moduleCache.set(pluginDir, module);
      return module;
    } catch (err) {
      this.moduleCache.set(pluginDir, null);
      this.failedPlugins.set(path.basename(pluginDir), errorMessage(err));
      logger.error('检查插件模块失败', err);
      return null;
    }
  }

  private createPluginContext(pluginName: string, config: Record<string, unknown>): PluginContext {
    const owner = pluginOwner(pluginName);
    const deps = this.deps;
    return {
      config,
      paths: deps.paths,
      registerTool: (tool: AesyClawTool): void => {
        deps.toolRegistry.register({ ...tool, owner });
      },
      unregisterTool: (name: string): void => {
        const existing = deps.toolRegistry.get(name);
        if (!existing) {
          return;
        }
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
    if (direct) {
      return direct;
    }
    return [...this.loadedPlugins.values()].find((plugin) => plugin.directoryName === nameOrAlias);
  }

  private getPluginConfig(module: PluginModule): PluginConfigLookup {
    const plugins = this.getConfigEntries();
    const entry = plugins.find(
      (candidate) =>
        candidate.name === module.definition.name || candidate.name === module.directoryName,
    );
    return {
      entry,
      enabled: entry?.enabled ?? true,
      options: optionsToRecord(entry?.options),
    };
  }

  private isDirectoryEnabled(directoryName: string): boolean {
    const entry = this.getConfigEntries().find((candidate) => candidate.name === directoryName);
    return entry?.enabled ?? true;
  }

  private getConfigEntries(): ReadonlyArray<Readonly<PluginConfigEntry>> {
    try {
      return this.deps.configManager.get('plugins') as ReadonlyArray<Readonly<PluginConfigEntry>>;
    } catch {
      return [];
    }
  }

  private async setPluginEnabled(pluginName: string, enabled: boolean): Promise<void> {
    const match = await this.findPlugin(pluginName);
    const aliases = new Set([
      pluginName,
      ...(match ? [match.definition.name, match.directoryName] : []),
    ]);
    const canonicalName = match?.definition.name ?? pluginName;
    const plugins = this.getConfigEntries().map((entry) => ({
      name: entry.name,
      enabled: aliases.has(entry.name) ? enabled : entry.enabled,
      ...(entry.options === undefined ? {} : { options: optionsToRecord(entry.options) }),
    }));

    const updatedExisting = plugins.some((entry) => aliases.has(entry.name));

    if (!updatedExisting) {
      plugins.push({ name: canonicalName, enabled });
    }

    await this.deps.configManager.set('plugins', plugins);
  }
}

function optionsToRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** 根据错误状态和启用状态解析插件状态字符串 */
function resolvePluginState(error: string | undefined, enabled: boolean): PluginLifecycleState {
  if (error) return 'failed';
  if (enabled) return 'unloaded';
  return 'disabled';
}
