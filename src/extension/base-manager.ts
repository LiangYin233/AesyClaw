/**
 * BaseExtensionManager — 扩展生命周期管理的泛型基类。
 *
 * 使用模板方法模式（Template Method Pattern），将 Plugin 和 Channel
 * 共享的生命周期逻辑（配置合并、TypeBox 校验、热重载状态机、Owner 清理）
 * 下沉到基类，子类只需实现差异化的 Context 构建和钩子逻辑。
 */

import { basename } from 'node:path';
import { createScopedLogger, type Logger } from '@aesyclaw/core/logger';
import { errorMessage } from '@aesyclaw/core/utils';
import {
  getExtensionFailureMessage,
  recordExtensionFailure,
  type ExtensionFailure,
} from '@aesyclaw/extension/failure';
import {
  extensionConfigsEqual,
  getBusinessDefaults,
  getExtensionConfigRecord,
  getExtensionUserConfig,
  hasExtensionConfigEntry,
  isExtensionConfigEnabled,
  isExtensionDefinitionEnabled,
  mergeExtensionConfig,
  setExtensionEnabledConfig,
  writeDefaultExtensionConfig,
} from '@aesyclaw/extension/config';
import { validateWithSchema } from '@aesyclaw/core/config/schema-utils';
import { discoverExtensionDirs, loadExtensionModule } from '@aesyclaw/extension/extension-loader';
import type { ConfigManager } from '@aesyclaw/core/config/config-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { ToolOwner } from '@aesyclaw/core/types';
import type {
  BaseExtensionDefinition,
  LoadedExtension,
  ExtensionStatus,
  ExtensionLifecycleState,
} from './types';

// ─── 抽象基类 ─────────────────────────────────────────────────

/**
 * 扩展生命周期管理的泛型基类。
 *
 * @template TDef - 扩展定义类型（PluginDefinition 或 ChannelPlugin）
 * @template TCtx - 扩展上下文类型（PluginContext 或 ChannelContext）
 */
export abstract class BaseExtensionManager<TDef extends BaseExtensionDefinition<TCtx>, TCtx> {
  /** 已注册的扩展定义（名称 → 定义） */
  readonly definitions = new Map<string, TDef>();

  /** 已加载的扩展运行时实例 */
  protected readonly loadedExtensions = new Map<string, LoadedExtension<TDef, TCtx>>();

  /** 加载失败的扩展（名称/目录名 → 结构化失败状态） */
  readonly failedExtensions = new Map<string, ExtensionFailure>();

  /** 配置引用缓存（扩展名称 → { current }），支持热更新 */
  protected readonly configRefs = new Map<string, { current: Record<string, unknown> }>();
  /** 扩展目录映射（名称 → 磁盘目录路径），在 discoverFromDisk 时记录 */
  protected readonly extensionDirs = new Map<string, string>();

  private _logger?: Logger;
  protected get logger(): Logger {
    return (this._logger ??= createScopedLogger(this.extensionType));
  }
  protected readonly configManager: ConfigManager;
  protected readonly toolRegistry: ToolRegistry;
  protected readonly commandRegistry: CommandRegistry;
  protected readonly hooksBus: IHooksBus;

  /** 扩展类型标识（'plugin' 或 'channel'） */
  protected abstract readonly extensionType: string;

  /** 配置键名前缀（'plugins' 或 'channels'） */
  protected abstract readonly configKey: string;

  /** 目录名前缀（'plugin_' 或 'channel_'） */
  protected abstract readonly dirPrefix: string;

  constructor(deps: {
    configManager: ConfigManager;
    toolRegistry: ToolRegistry;
    commandRegistry: CommandRegistry;
    hooksBus: IHooksBus;
  }) {
    this.configManager = deps.configManager;
    this.toolRegistry = deps.toolRegistry;
    this.commandRegistry = deps.commandRegistry;
    this.hooksBus = deps.hooksBus;
  }
  // ─── 抽象方法：子类必须实现 ─────────────────────────────────

  /**
   * 创建扩展的上下文对象。
   * 子类根据自身类型构建特定的 Context（PluginContext 或 ChannelContext）。
   */
  protected abstract createContext(
    definition: TDef,
    owner: string,
    ref: { current: Record<string, unknown> },
    state: Record<string, unknown>,
  ): TCtx;

  /**
   * 从动态导入的模块中发现并校验扩展定义。
   * 子类实现具体的校验逻辑（如额外检查 send 方法）。
   */
  protected abstract discoverDefinition(imported: unknown): TDef | null;

  // ─── 可选钩子：子类可覆盖 ───────────────────────────────────

  /**
   * 扩展加载完成后的钩子。
   * 用于 Plugin 注册中间件、Channel 注册路由等差异化逻辑。
   */
  protected async onAfterLoad(_definition: TDef, _context: TCtx): Promise<void> {
    // 默认无操作
  }

  /**
   * 扩展卸载前的钩子。
   * 用于 Plugin 注销中间件、Channel 清理缓冲区等差异化逻辑。
   */
  protected async onBeforeUnload(_definition: TDef, _context: TCtx): Promise<void> {
    // 默认无操作
  }

  /**
   * 扩展卸载后的钩子。
   * 用于清理 Owner 相关资源（工具、命令等）。
   * 基类默认调用 cleanupOwner，子类可覆盖添加额外清理。
   */
  protected async onAfterUnload(name: string): Promise<void> {
    const owner = this.resolveOwner(name);
    this.cleanupOwner(owner);
  }

  /**
   * 从磁盘查找扩展定义。
   * 子类可覆盖此方法以提供自定义的查找逻辑。
   */
  protected async findExtensionOnDisk(
    _name: string,
  ): Promise<{ definition: TDef; directory?: string } | null> {
    return null;
  }

  // ─── 核心生命周期方法 ───────────────────────────────────────

  /**
   * 设置扩展运行时：从磁盘发现并注册所有扩展定义。
   * 子类在 setup() 后调用 startAll() 启动已启用的扩展。
   */
  protected async discoverFromDisk(extensionsDir: string): Promise<void> {
    const dirs = await discoverExtensionDirs({
      extensionsDir,
      directoryPrefix: this.dirPrefix,
      logger: this.logger,
      unreadableMessage: `${this.extensionType} 扩展目录不可读`,
      inspectFailureMessage: `检查 ${this.extensionType} 目录候选失败`,
      candidateField: `${this.extensionType}Dir`,
    });

    for (const dir of dirs) {
      try {
        const mod = await loadExtensionModule(dir, this.extensionType, (imported) =>
          this.discoverDefinition(imported),
        );
        this.definitions.set(mod.definition.name, mod.definition);
        this.extensionDirs.set(mod.definition.name, mod.directory);
      } catch (err) {
        recordExtensionFailure(this.failedExtensions, basename(dir), 'discover', err);
        this.logger.warn(`${this.extensionType} 扩展加载失败`, {
          dir,
          error: errorMessage(err),
        });
      }
    }
  }

  /**
   * 注册扩展定义（用于动态注册，如插件注册 Channel）。
   */
  register(definition: TDef, owner?: string): void {
    const existing = this.definitions.get(definition.name);
    if (existing && existing !== definition) {
      throw new Error(`${this.extensionType} "${definition.name}" 已注册`);
    }
    this.definitions.set(definition.name, definition);
    // 注册默认配置（如果 configManager 支持）
    if (typeof this.configManager.registerDefaults === 'function') {
      this.configManager.registerDefaults(
        `${this.configKey}.${definition.name}`,
        this.getManagedDefaults(definition),
      );
    }
    if (owner) {
      // 动态注册时记录所有者
      this.logger.debug(`${this.extensionType} 已注册`, { name: definition.name, owner });
    }
  }

  /**
   * 注销扩展定义并停止运行中的实例。
   */
  async unregister(name: string): Promise<void> {
    await this.stop(name);
    this.definitions.delete(name);
    this.failedExtensions.delete(name);
    this.extensionDirs.delete(name);
    this.logger.debug(`${this.extensionType} 已注销`, { name });
  }

  /**
   * 按所有者注销所有扩展。
   */
  async unregisterByOwner(owner: string): Promise<void> {
    // 默认空实现，子类应覆盖以提供具体清理逻辑
    this.logger.debug(`按所有者注销 ${this.extensionType}`, { owner });
  }

  /**
   * 启动指定扩展。
   */
  async start(name: string): Promise<LoadedExtension<TDef, TCtx> | null> {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`${this.extensionType} "${name}" 未注册`);
    }

    // 如果已加载，先卸载
    if (this.loadedExtensions.has(name)) {
      await this.stop(name);
    }

    // A. 配置合并
    let mergedConfig = this.getMergedConfig(definition);

    // B. 检查是否启用（在剥离 enabled 之前）
    if (!this.isEnabled(mergedConfig)) {
      return null;
    }

    // C. TypeBox Schema 校验
    mergedConfig = this.validateConfig(definition, mergedConfig);

    // D. 创建上下文
    const owner = this.resolveOwner(name);
    const ref: { current: Record<string, unknown> } = { current: mergedConfig };
    this.configRefs.set(name, ref);
    const state: Record<string, unknown> = {};
    const context = this.createContext(definition, owner, ref, state);

    // E. 调用初始化
    try {
      await definition.init(context);
    } catch (err) {
      this.configRefs.delete(name);
      this.cleanupOwner(owner);
      throw err;
    }

    // F. 记录加载状态。插件 init 期间可能通过 ctx.config.self.set() 更新配置引用，
    // 因此这里使用 ref.current 作为运行时最终配置，避免后续默认值写回覆盖 init 产生的配置。
    const runtimeConfig = ref.current;
    const loaded: LoadedExtension<TDef, TCtx> = {
      definition,
      config: runtimeConfig,
      context,
      loadedAt: new Date(),
      owner,
      state,
    };
    this.loadedExtensions.set(name, loaded);
    this.failedExtensions.delete(name);

    // G. 触发子类钩子
    await this.onAfterLoad(definition, context);

    // H. 自动写入/回填配置条目（包含 schema default 填充后的值）
    if (!this.configsEqual(this.getUserConfig(name), runtimeConfig)) {
      await this.writeDefaultConfig(name, runtimeConfig);
    }

    this.logger.info(`${this.extensionType} 已启动`, { name });
    return loaded;
  }

  /**
   * 停止指定扩展。
   */
  async stop(name: string): Promise<void> {
    const loaded = this.loadedExtensions.get(name);
    if (!loaded) return;

    try {
      // A. 触发子类卸载前钩子
      await this.onBeforeUnload(loaded.definition, loaded.context);

      // B. 调用扩展的 destroy
      if (loaded.definition.destroy) {
        await loaded.definition.destroy(loaded.context);
      }
    } finally {
      // C. 触发卸载后钩子（清理 Owner 资源）
      await this.onAfterUnload(name);

      // D. 清理配置引用
      this.configRefs.delete(name);

      // E. 移除加载记录
      this.loadedExtensions.delete(name);
      this.failedExtensions.delete(name);

      this.logger.info(`${this.extensionType} 已停止`, { name });
    }
  }

  /**
   * 启动所有已启用的扩展。
   */
  async startAll(): Promise<void> {
    for (const definition of this.definitions.values()) {
      if (!this.isDefinitionEnabled(definition.name)) {
        this.failedExtensions.delete(definition.name);
        this.logger.info('跳过已禁用的扩展', { name: definition.name });
        continue;
      }

      try {
        await this.start(definition.name);
      } catch (err) {
        recordExtensionFailure(this.failedExtensions, definition.name, 'start', err);
        this.logger.error(`${this.extensionType} "${definition.name}" 启动失败`, err);
      }
    }
  }

  /**
   * 停止所有已加载的扩展（按逆序）。
   */
  async stopAll(): Promise<void> {
    const names = [...this.loadedExtensions.keys()].reverse();
    for (const name of names) {
      try {
        await this.stop(name);
      } catch (err) {
        this.logger.error(`${this.extensionType} "${name}" 停止失败`, err);
      }
    }
    this.logger.info(`所有 ${this.extensionType} 已停止`);
  }

  /**
   * 启用指定扩展（写入配置并启动）。
   */
  async enable(name: string): Promise<void> {
    await this.setExtensionEnabled(name, true);
    if (!this.loadedExtensions.has(name)) {
      try {
        // 先检查是否已注册
        if (this.definitions.has(name)) {
          await this.start(name);
        } else {
          // 尝试从磁盘查找
          const match = await this.findExtensionOnDisk(name);
          if (match) {
            this.definitions.set(match.definition.name, match.definition);
            if (match.directory) {
              this.extensionDirs.set(match.definition.name, match.directory);
            }
            await this.start(match.definition.name);
          }
        }
      } catch (err) {
        recordExtensionFailure(this.failedExtensions, name, 'enable', err);
        this.logger.error(`启用后 ${this.extensionType} "${name}" 启动失败`, err);
      }
    }
  }

  /**
   * 禁用指定扩展（停止并写入配置）。
   */
  async disable(name: string): Promise<void> {
    await this.stop(name);
    await this.setExtensionEnabled(name, false);
  }

  /**
   * 双阶段热重载：检查配置变更并增量重启。
   */
  async handleConfigReload(): Promise<void> {
    // Phase 1: 已加载的扩展 — 配置变更则重启，禁用则停止
    for (const [name, loaded] of [...this.loadedExtensions]) {
      const definition = this.definitions.get(name);
      if (!definition) {
        // 定义已被移除 → 停止
        await this.stop(name);
        continue;
      }

      const freshConfig = this.getMergedConfig(definition);
      if (!this.isEnabled(freshConfig)) {
        // 已禁用 → 停止
        await this.stop(name);
        continue;
      }

      // 配置未变更 → 跳过
      if (this.configsEqual(loaded.config, freshConfig)) continue;

      // 配置变更 → 重启
      this.logger.info(`${this.extensionType} "${name}" 配置已变更，正在重启`);
      try {
        await this.stop(name);
        await this.start(name);
      } catch (err) {
        recordExtensionFailure(this.failedExtensions, name, 'configReload', err);
        this.logger.error(`热重载时重启 ${this.extensionType} "${name}" 失败`, err);
      }
    }

    // Phase 2: 已注册但未加载的扩展 — 如果启用则启动
    for (const definition of this.definitions.values()) {
      if (this.loadedExtensions.has(definition.name)) continue;
      if (!this.isDefinitionEnabled(definition.name)) continue;

      try {
        await this.start(definition.name);
      } catch (err) {
        recordExtensionFailure(this.failedExtensions, definition.name, 'configReload', err);
        this.logger.error(`热重载时启动 ${this.extensionType} "${definition.name}" 失败`, err);
      }
    }
  }

  // ─── 查询方法 ───────────────────────────────────────────────

  /**
   * 列出当前内存中已注册扩展的启用配置状态。
   * 不扫描磁盘，也不表达运行态。
   */
  listEnabledExtensions(): Array<{ name: string; enabled: boolean }> {
    return [...this.definitions.values()]
      .map((definition) => ({
        name: definition.name,
        enabled: this.isDefinitionEnabled(definition.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 获取当前内存中的完整扩展定义。
   */
  getDefinition(name: string): TDef {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`${this.extensionType} "${name}" 未注册`);
    }
    return definition;
  }

  /**
   * 重载当前内存中已知扩展。不扫描磁盘。
   */
  async reload(): Promise<void>;
  async reload(name: string): Promise<boolean>;
  async reload(name?: string): Promise<void | boolean> {
    if (name !== undefined) {
      return await this.reloadOne(name);
    }

    for (const definition of this.definitions.values()) {
      if (!this.isDefinitionEnabled(definition.name)) continue;
      await this.reloadOne(definition.name);
    }
  }

  private async reloadOne(name: string): Promise<boolean> {
    const definition = this.definitions.get(name);
    if (!definition) {
      throw new Error(`${this.extensionType} "${name}" 未注册`);
    }
    if (!this.isDefinitionEnabled(name)) {
      return false;
    }

    const wasLoaded = this.loadedExtensions.has(name);
    if (wasLoaded) {
      await this.stop(name);
    }

    try {
      const loaded = await this.start(name);
      return loaded !== null;
    } catch (err) {
      recordExtensionFailure(this.failedExtensions, name, 'manualReload', err);
      this.logger.error(`${this.extensionType} "${name}" 重载失败，扩展已停止`, err);
      return false;
    }
  }

  /**
   * 获取已加载的扩展实例。
   */
  getLoaded(name: string): LoadedExtension<TDef, TCtx> | undefined {
    return this.loadedExtensions.get(name);
  }

  /**
   * 检查扩展是否已加载。
   */
  isLoaded(name: string): boolean {
    return this.loadedExtensions.has(name);
  }

  /**
   * 列出所有扩展的状态。
   */
  listExtensions(): ExtensionStatus[] {
    const statuses: ExtensionStatus[] = [];
    for (const definition of this.definitions.values()) {
      const enabled = this.isDefinitionEnabled(definition.name);
      const error = getExtensionFailureMessage(this.failedExtensions, definition.name);
      statuses.push({
        name: definition.name,
        version: definition.version,
        description: definition.description,
        enabled,
        state: this.resolveState(error, this.loadedExtensions.has(definition.name), enabled),
        error,
      });
    }
    return statuses.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * 获取所有已注册扩展的定义信息。
   */
  getRegisteredDefinitions(): Array<{
    name: string;
    version?: string;
    description?: string;
    defaultConfig?: Record<string, unknown>;
  }> {
    return [...this.definitions.values()].map((def) => ({
      name: def.name,
      version: def.version,
      description: def.description,
      defaultConfig: def.defaultConfig,
    }));
  }

  // ─── 配置管理（内部方法） ───────────────────────────────────

  private getConfigAccess(): { configManager: ConfigManager; configKey: string } {
    return { configManager: this.configManager, configKey: this.configKey };
  }

  private getConfigWriteAccess(): {
    configManager: ConfigManager;
    configKey: string;
    extensionType: string;
    logger: Logger;
  } {
    return {
      configManager: this.configManager,
      configKey: this.configKey,
      extensionType: this.extensionType,
      logger: this.logger,
    };
  }

  /**
   * 校验扩展配置并填充 schema default。
   * 子类可覆盖以处理保留字段（如插件的 enabled）。
   */
  protected validateConfig(definition: TDef, config: Record<string, unknown>): Record<string, unknown> {
    if (!definition.configSchema) return config;
    return validateWithSchema<Record<string, unknown>>(
      definition.configSchema,
      config,
      `${this.extensionType}配置(${definition.name})`,
    );
  }

  /**
   * 获取合并后的配置（默认配置 + 用户配置）。
   */
  protected getMergedConfig(definition: TDef): Record<string, unknown> {
    const userConfig = this.getUserConfig(definition.name);
    return mergeExtensionConfig(this.getManagedDefaults(definition), userConfig);
  }

  /**
   * 获取扩展业务默认配置。
   *
   * enabled 是框架管理字段，具体默认值由插件/频道管理器分别决定。
   */
  protected getManagedDefaults(definition: TDef): Record<string, unknown> {
    return getBusinessDefaults(definition);
  }

  /**
   * 从配置中读取用户的扩展配置。
   */
  protected getUserConfig(name: string): Record<string, unknown> {
    return getExtensionUserConfig(this.getConfigAccess(), name);
  }

  /**
   * 获取整个配置段（如 plugins 或 channels）。
   */
  protected getConfigRecord(): Record<string, unknown> {
    return getExtensionConfigRecord(this.getConfigAccess());
  }

  /**
   * 检查扩展配置是否启用。
   */
  protected isEnabled(config: Record<string, unknown>): boolean {
    return isExtensionConfigEnabled(config);
  }

  /**
   * 检查扩展定义在配置中是否启用。
   */
  protected isDefinitionEnabled(name: string): boolean {
    return isExtensionDefinitionEnabled(this.getConfigAccess(), name);
  }

  /**
   * 检查配置中是否存在该扩展的条目。
   */
  protected hasConfigEntry(name: string): boolean {
    return hasExtensionConfigEntry(this.getConfigAccess(), name);
  }

  /**
   * 设置扩展的启用/禁用状态。
   */
  protected async setExtensionEnabled(name: string, enabled: boolean): Promise<void> {
    const definition = this.definitions.get(name);
    await setExtensionEnabledConfig(
      this.getConfigAccess(),
      name,
      enabled,
      definition ? this.getManagedDefaults(definition) : undefined,
    );
  }

  /**
   * 写入扩展的默认配置条目。
   */
  protected async writeDefaultConfig(name: string, config: Record<string, unknown>): Promise<void> {
    await writeDefaultExtensionConfig(this.getConfigWriteAccess(), name, config);
  }

  // ─── Owner 管理（内部方法） ─────────────────────────────────

  /**
   * 解析扩展的 Owner 标识符。
   */
  protected resolveOwner(name: string): ToolOwner {
    return `${this.extensionType}:${name}` as ToolOwner;
  }

  /**
   * 清理 Owner 相关的资源（工具、命令）。
   */
  protected cleanupOwner(owner: ToolOwner): void {
    this.toolRegistry.unregisterByOwner(owner);
    this.commandRegistry.unregisterByScope(owner);
  }

  // ─── 状态解析 ───────────────────────────────────────────────

  /**
   * 解析扩展的生命周期状态。
   */
  protected resolveState(
    error: string | undefined,
    loaded: boolean,
    enabled: boolean,
  ): ExtensionLifecycleState {
    if (error) return 'failed';
    if (loaded) return 'loaded';
    if (enabled) return 'unloaded';
    return 'disabled';
  }

  /**
   * 深度比较两个配置对象是否相等（忽略键序差异）。
   */
  protected configsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    return extensionConfigsEqual(a, b);
  }
}
