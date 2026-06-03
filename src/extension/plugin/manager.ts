/** PluginManager — 插件生命周期管理，继承自 BaseExtensionManager。 */

import path from 'node:path';
import { errorMessage } from '@aesyclaw/core/utils';
import { BaseExtensionManager } from '@aesyclaw/extension/base-manager';
import { createPluginContext } from './context';
import type {
  PluginDefinition,
  PluginContext,
  PluginStatus,
  PluginManagerDependencies,
} from './types';
import { discoverPluginDefinition } from './types';
import { discoverPluginDirs, safeLoadModule } from './loader';
import { getPluginConfig } from './config';
import type { LoadedExtension } from '@aesyclaw/extension/types';

// ─── PluginManager ────────────────────────────────────────────

/**
 * 插件管理器 — 负责插件的发现、加载、卸载、启用/禁用及配置热重载。
 * 继承自 BaseExtensionManager，复用通用生命周期逻辑。
 */
export class PluginManager extends BaseExtensionManager<PluginDefinition, PluginContext> {
  protected readonly extensionType = 'plugin';
  protected readonly configKey = 'plugins';
  protected readonly dirPrefix = 'plugin_';

  private readonly extensionsDir: string;

  constructor(private readonly deps: PluginManagerDependencies) {
    super({
      configManager: deps.configManager,
      toolRegistry: deps.toolRegistry,
      commandRegistry: deps.commandRegistry,
      hooksBus: deps.hooksBus,
    });
    this.extensionsDir = deps.paths.extensionsDir;
  }

  // ─── 抽象方法实现 ───────────────────────────────────────────

  protected createContext(
    definition: PluginDefinition,
    _owner: string,
    ref: { current: Record<string, unknown> },
    _state: Record<string, unknown>,
  ): PluginContext {
    const directory = this.extensionDirs.get(definition.name);
    const directoryName = directory ? path.basename(directory) : `plugin_${definition.name}`;
    return createPluginContext(this.deps, this.deps.paths, definition, directoryName, ref);
  }

  protected discoverDefinition(imported: unknown): PluginDefinition | null {
    return discoverPluginDefinition(imported);
  }

  // ─── 差异化钩子 ─────────────────────────────────────────────

  protected async onBeforeUnload(
    definition: PluginDefinition,
    _context: PluginContext,
  ): Promise<void> {
    // 注销插件的中间件
    this.hooksBus.unregisterByPrefix(`plugin:${definition.name}:`);
  }

  protected async findExtensionOnDisk(
    name: string,
  ): Promise<{ definition: PluginDefinition; directory?: string } | null> {
    // 先查磁盘
    const pluginDirs = await discoverPluginDirs(this.extensionsDir);
    for (const pluginDir of pluginDirs) {
      const module = await safeLoadModule(pluginDir, this.failedExtensions);
      if (!module) continue;
      if (module.definition.name === name) {
        return { definition: module.definition, directory: pluginDir };
      }
    }
    return null;
  }

  // ─── 扩展基类方法 ───────────────────────────────────────────

  /**
   * 发现并加载所有已启用的插件。
   */
  async setup(): Promise<void> {
    await this.discoverFromDisk(this.extensionsDir);
    await this.startAll();
  }

  /**
   * 卸载所有已加载的插件。
   */
  async destroy(): Promise<void> {
    await this.stopAll();
  }

  /**
   * 按所有者注销所有插件。
   */
  async unregisterByOwner(owner: string): Promise<void> {
    for (const [name, loaded] of this.loadedExtensions) {
      if (loaded.owner === owner) {
        await this.unregister(name);
      }
    }
  }

  // ─── 插件特有方法 ───────────────────────────────────────────

  /**
   * 列出当前内存中已知插件及其配置启用状态。
   */
  listEnabledPlugins(): Array<{ name: string; enabled: boolean }> {
    return this.listEnabledExtensions();
  }

  /**
   * 获取当前内存中的完整插件定义。
   */
  getDefinition(name: string): PluginDefinition {
    return super.getDefinition(name);
  }

  /**
   * 加载指定目录的插件（用于磁盘插件）。
   */
  async load(pluginDir: string): Promise<LoadedExtension<PluginDefinition, PluginContext> | null> {
    try {
      const { loadExtensionModule } = await import('@aesyclaw/extension/extension-loader');
      const module = await loadExtensionModule(pluginDir, 'Plugin', discoverPluginDefinition);
      const pluginName = module.definition.name;
      this.definitions.set(pluginName, module.definition);
      this.extensionDirs.set(pluginName, pluginDir);
      return await this.start(pluginName);
    } catch (err) {
      this.failedExtensions.set(path.basename(pluginDir), errorMessage(err));
      return null;
    }
  }

  /**
   * 列出所有插件的状态。
   */
  async listPlugins(): Promise<PluginStatus[]> {
    const statuses = new Map<string, PluginStatus>();

    // 已加载的插件
    for (const loaded of this.loadedExtensions.values()) {
      const directory = this.extensionDirs.get(loaded.definition.name);
      const dirName = directory ? path.basename(directory) : `plugin_${loaded.definition.name}`;
      statuses.set(dirName, {
        name: loaded.definition.name,
        directoryName: dirName,
        version: loaded.definition.version,
        description: loaded.definition.description,
        enabled: true,
        state: 'loaded',
        directory: directory ?? path.join(this.extensionsDir, dirName),
      });
    }

    // 发现磁盘上的插件
    const discovered = await discoverPluginDirs(this.extensionsDir);
    for (const pluginDir of discovered) {
      const directoryName = path.basename(pluginDir);
      if (statuses.has(directoryName)) continue;

      const module = await safeLoadModule(pluginDir, this.failedExtensions);
      const configLookup = module ? getPluginConfig(this.getConfigRecord(), module) : null;
      const enabled = configLookup?.enabled ?? true;
      const name = module?.definition.name ?? directoryName;
      const error = this.failedExtensions.get(name) ?? this.failedExtensions.get(directoryName);
      statuses.set(directoryName, {
        name,
        directoryName,
        version: module?.definition.version,
        description: module?.definition.description,
        enabled,
        state: this.resolveState(error, false, enabled),
        directory: pluginDir,
        error,
      });
    }

    return [...statuses.values()].sort((a, b) => a.directoryName.localeCompare(b.directoryName));
  }

  /**
   * 获取插件定义列表。
   */
  async getPluginDefinitions(): Promise<
    Array<{
      name: string;
      version?: string;
      description?: string;
      configSchema?: unknown;
    }>
  > {
    const dirs = await discoverPluginDirs(this.extensionsDir);
    const results: Array<{
      name: string;
      version?: string;
      description?: string;
      configSchema?: unknown;
    }> = [];
    for (const pluginDir of dirs) {
      const module = await safeLoadModule(pluginDir, this.failedExtensions);
      if (!module) continue;
      results.push({
        name: module.definition.name,
        version: module.definition.version,
        description: module.definition.description,
        configSchema: module.definition.configSchema,
      });
    }
    return results;
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────
