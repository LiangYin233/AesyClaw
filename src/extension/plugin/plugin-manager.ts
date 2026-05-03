/** 插件管理器 — 加载、卸载并跟踪插件生命周期。 */

import path from 'node:path';
import { createScopedLogger } from '../../core/logger';
import { errorMessage, isRecord, mergeDefaults, requireInitialized } from '../../core/utils';
import type { CommandDefinition } from '../../core/types';
import type { PluginConfigEntry } from '../../core/config/schema';
import type { AesyClawTool } from '../../tool/tool-registry';
import { PluginLoader } from './plugin-loader';
import { SerialExecutor } from '../../utils/serial-executor';
import type {
  LoadedPlugin,
  PluginConfigLookup,
  PluginContext,
  PluginManagerDependencies,
  PluginModule,
  PluginStatus,
} from './plugin-types';
import { pluginOwner } from './plugin-types';

const logger = createScopedLogger('plugin-manager');

/** pluginLoader 始终在 initialize() 内被赋默认值，内部访问时保证存在 */
type ResolvedPluginDeps = PluginManagerDependencies & { pluginLoader: PluginLoader };

export class PluginManager {
  private deps: PluginManagerDependencies | null = null;
  private readonly loadedPlugins = new Map<string, LoadedPlugin>();
  private readonly failedPlugins = new Map<string, string>();
  private readonly moduleCache = new Map<string, PluginModule | null>();
  private serialExecutor = new SerialExecutor();

  constructor() {
    // 轻量构造器 — 通过 initialize() 注入依赖
  }

  async initialize(deps: PluginManagerDependencies): Promise<void> {
    if (this.deps) {
      logger.warn('PluginManager 已初始化 — 跳过');
      return;
    }
    this.deps = {
      ...deps,
      pluginLoader: deps.pluginLoader ?? new PluginLoader(),
    };
  }

  async destroy(): Promise<void> {
    await this.unloadAll();
    this.deps = null;
  }

  private requireDeps(): ResolvedPluginDeps {
    return requireInitialized(this.deps, 'PluginManager') as ResolvedPluginDeps;
  }

  async loadAll(): Promise<void> {
    const pluginDirs = await this.requireDeps().pluginLoader.discover();
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

  async load(pluginDir: string): Promise<LoadedPlugin | null> {
    const module = await this.requireDeps().pluginLoader.load(pluginDir);
    const pluginName = module.definition.name;

    if (this.loadedPlugins.has(pluginName)) {
      await this.unload(pluginName);
    }

    const configLookup = this.getPluginConfig(module);
    const mergedConfig = mergeDefaults(
      module.definition.defaultConfig ?? {},
      configLookup.options,
    );
    if (!configLookup.enabled) {
      logger.info('跳过已禁用的插件', { pluginName });
      return null;
    }

    const owner = pluginOwner(pluginName);
    const context = this.createPluginContext(pluginName, mergedConfig);

    try {
      await module.definition.init(context);
      if (module.definition.hooks) {
        this.requireDeps().hookRegistry.register(pluginName, module.definition.hooks);
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
      await this.requireDeps().configManager.update({ plugins }).catch((err) => {
        logger.warn(`自动写入插件 "${pluginName}" 的配置条目失败`, err);
      });
    }

    logger.info('插件已加载', { pluginName, directoryName: module.directoryName });
    return loaded;
  }

  async unload(pluginName: string): Promise<void> {
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

  async disable(pluginName: string): Promise<void> {
    await this.unload(pluginName);
    await this.setPluginEnabled(pluginName, false);
  }

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

    const discovered = await this.requireDeps().pluginLoader.discover();
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
        state: error ? 'failed' : enabled ? 'unloaded' : 'disabled',
        directory: pluginDir,
        error,
      });
    }

    return [...statuses.values()].sort((a, b) => a.directoryName.localeCompare(b.directoryName));
  }

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

    const pluginDirs = await this.requireDeps().pluginLoader.discover();
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

  async handleConfigReload(): Promise<void> {
    return await this.serialExecutor.execute(async () => {
      await this.unloadAll();
      this.moduleCache.clear();
      await this.loadAll();
    }, '插件配置重载');
  }

  getLoaded(pluginName: string): LoadedPlugin | undefined {
    return this.findLoadedPlugin(pluginName);
  }

  /** 获取所有已发现插件的定义及其元数据。 */
  async getPluginDefinitions(): Promise<
    Array<{
      name: string;
      version?: string;
      description?: string;
      defaultConfig?: Record<string, unknown>;
    }>
  > {
    const result = [];
    const discovered = await this.requireDeps().pluginLoader.discover();
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

  private createPluginContext(pluginName: string, config: Record<string, unknown>): PluginContext {
    const owner = pluginOwner(pluginName);
    const deps = this.requireDeps();
    return {
      config,
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
    this.requireDeps().hookRegistry.unregister(pluginName);
    this.requireDeps().toolRegistry.unregisterByOwner(owner);
    this.requireDeps().commandRegistry.unregisterByScope(owner);
    await this.requireDeps().channelManager?.unregisterByOwner(owner);
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
      return this.requireDeps().configManager.get('plugins');
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

    await this.requireDeps().configManager.update({ plugins });
  }

  private async safeLoadModule(pluginDir: string): Promise<PluginModule | null> {
    if (this.moduleCache.has(pluginDir)) {
      return this.moduleCache.get(pluginDir) ?? null;
    }
    try {
      const module = await this.requireDeps().pluginLoader.load(pluginDir);
      this.moduleCache.set(pluginDir, module);
      return module;
    } catch (err) {
      this.moduleCache.set(pluginDir, null);
      this.failedPlugins.set(path.basename(pluginDir), errorMessage(err));
      logger.error('检查插件模块失败', err);
      return null;
    }
  }

}

function optionsToRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
