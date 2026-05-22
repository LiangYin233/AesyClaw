/**
 * plugin-discovery — 插件发现与模块加载。
 *
 * 负责扫描磁盘插件目录、缓存模块定义、按名称查找等查询操作。
 * 不涉及插件生命周期（加载/启用/禁用）。
 */

import path from 'node:path';
import { createScopedLogger } from '@aesyclaw/core/logger';
import { errorMessage } from '@aesyclaw/core/utils';
import {
  discoverExtensionDirs,
  loadExtensionModule,
} from '@aesyclaw/extension/extension-loader';
import {
  discoverPluginDefinition,
  type PluginModule,
} from './plugin-types';

const logger = createScopedLogger('plugin-discovery');

export type PluginDiscoveryDeps = {
  paths: { extensionsDir: string };
};

export class PluginDiscovery {
  private readonly moduleCache = new Map<string, PluginModule | null>();

  constructor(
    private readonly deps: PluginDiscoveryDeps,
    private readonly failedPlugins: Map<string, string>,
  ) {}

  private get extensionsDir(): string {
    return this.deps.paths.extensionsDir;
  }

  /** 扫描磁盘插件目录 */
  async discoverPluginDirs(): Promise<string[]> {
    return await discoverExtensionDirs({
      extensionsDir: this.extensionsDir,
      directoryPrefix: 'plugin_',
      logger,
      unreadableMessage: '插件扩展目录不可读',
      inspectFailureMessage: '检查插件目录候选失败',
      candidateField: 'pluginDir',
    });
  }

  /** 安全加载插件模块（带缓存） */
  async safeLoadModule(pluginDir: string): Promise<PluginModule | null> {
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

  /** 清除模块缓存 */
  clearCache(): void {
    this.moduleCache.clear();
  }

  /** 按名称或目录名查找插件 */
  async findPlugin(
    nameOrAlias: string,
    loadedPlugins: Map<string, { definition: PluginModule['definition']; directory: string; directoryName: string }>,
  ): Promise<PluginModule | null> {
    // 先查已加载的
    for (const loaded of loadedPlugins.values()) {
      if (loaded.definition.name === nameOrAlias || loaded.directoryName === nameOrAlias) {
        return {
          definition: loaded.definition,
          directory: loaded.directory,
          directoryName: loaded.directoryName,
          entryPath: '',
        };
      }
    }

    // 再扫磁盘
    const pluginDirs = await this.discoverPluginDirs();
    for (const pluginDir of pluginDirs) {
      const directoryName = path.basename(pluginDir);
      const module = await this.safeLoadModule(pluginDir);
      if (!module) continue;
      if (directoryName === nameOrAlias || module.definition.name === nameOrAlias) {
        return module;
      }
    }
    return null;
  }

  /** 获取所有已发现插件的定义信息 */
  async getPluginDefinitions(): Promise<
    Array<{
      name: string;
      version?: string;
      description?: string;
      defaultConfig?: Record<string, unknown>;
    }>
  > {
    const result: Array<{
      name: string;
      version?: string;
      description?: string;
      defaultConfig?: Record<string, unknown>;
    }> = [];
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

  /** 获取模块缓存中的模块（已缓存则直接返回，否则安全加载） */
  async getOrLoadModule(pluginDir: string): Promise<PluginModule | null> {
    return await this.safeLoadModule(pluginDir);
  }
}
