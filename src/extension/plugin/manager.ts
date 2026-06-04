/** PluginManager — 插件生命周期 facade，委托统一 Extension host。 */

import path from 'node:path';
import { getExtensionFailureMessage, recordExtensionFailure } from '@aesyclaw/extension/failure';
import { BaseExtensionManager } from '@aesyclaw/extension/base-manager';
import { createPluginSpec } from './spec';
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
 * 插件管理器 — 负责插件发现、插件特有查询，以及委托统一 Extension host 管理生命周期。
 */
export class PluginManager extends BaseExtensionManager<PluginDefinition, PluginContext> {
  private readonly extensionsDir: string;

  constructor(private readonly deps: PluginManagerDependencies) {
    super(createPluginSpec(deps), {
      configManager: deps.configManager,
      toolRegistry: deps.toolRegistry,
      commandRegistry: deps.commandRegistry,
      hooksBus: deps.hooksBus,
    });
    this.extensionsDir = deps.paths.extensionsDir;
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
      recordExtensionFailure(this.failedExtensions, path.basename(pluginDir), 'load', err);
      return null;
    }
  }

  /**
   * 列出所有插件的状态。
   */
  async listPlugins(): Promise<PluginStatus[]> {
    const statuses = new Map<string, PluginStatus>();

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

    const discovered = await discoverPluginDirs(this.extensionsDir);
    for (const pluginDir of discovered) {
      const directoryName = path.basename(pluginDir);
      if (statuses.has(directoryName)) continue;

      const module = await safeLoadModule(pluginDir, this.failedExtensions);
      const configLookup = module ? getPluginConfig(this.getConfigRecord(), module) : null;
      const enabled = configLookup?.enabled ?? true;
      const name = module?.definition.name ?? directoryName;
      const error =
        getExtensionFailureMessage(this.failedExtensions, name) ??
        getExtensionFailureMessage(this.failedExtensions, directoryName);
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
