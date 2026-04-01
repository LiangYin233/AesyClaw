/**
 * 插件协调器
 * 
 * 核心类，负责：
 * - 插件的发现、加载、启用、禁用
 * - 7个钩子的执行
 * - 命令匹配和执行
 * - 工具注册/注销
 */

import type { InboundMessage, OutboundMessage, PluginErrorContext, Config, LLMResponse } from '../../../types.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { Logger } from '../../../platform/observability/index.js';
import type {
  FoundPlugin,
  RunningPlugin,
  PluginConfigs,
  PluginMetadata,
  PluginSettings,
  ToolCallInfo,
  AgentContext,
  CommandResult,
  SendOptions
} from './core/types.js';
import {
  scanPlugins,
  startPlugin,
  stopPlugin
} from './core/plugin-loader.js';
import {
  runTransformChain,
  runAfterToolChain,
  runObservers,
  runAgentCompleteObservers,
  matchCommand
} from './core/plugin-hooks.js';

/** 协调器依赖 */
export interface CoordinatorDependencies {
  workspace: string;
  tempDir: string;
  pluginsDir: string;
  getConfig: () => Config;
  toolRegistry?: ToolRegistry;
  outboundPublisher: (message: OutboundMessage) => Promise<void>;
  logger: Logger;
}

export class PluginCoordinator {
  private readonly logger: Logger;
  private readonly plugins = new Map<string, RunningPlugin>();
  private discoveredPlugins: FoundPlugin[] | null = null;
  private pluginConfigs: PluginConfigs = {};

  constructor(private readonly deps: CoordinatorDependencies) {
    this.logger = deps.logger.child('PluginCoordinator');
  }

  /**
   * 设置工具注册表
   * 
   * 如果初始化时未提供，可在后续调用此方法设置
   */
  setToolRegistry(toolRegistry: ToolRegistry): void {
    this.deps.toolRegistry = toolRegistry;
  }

  /**
   * 设置消息发布器
   * 
   * 用于在插件系统初始化后设置真正的消息发送处理器
   */
  setOutboundPublisher(publisher: (message: OutboundMessage) => Promise<void>): void {
    this.deps.outboundPublisher = publisher;
  }

  // ========== 插件生命周期 ==========

  /**
   * 扫描并发现所有插件
   *
   * @param forceRefresh - 是否强制重新扫描，忽略缓存
   * @returns 发现的所有插件列表
   */
  async discover(forceRefresh = false): Promise<FoundPlugin[]> {
    if (!forceRefresh && this.discoveredPlugins) {
      return this.discoveredPlugins;
    }

    this.discoveredPlugins = await scanPlugins(this.deps.pluginsDir, this.logger);
    return this.discoveredPlugins;
  }

  /**
   * 刷新插件列表
   *
   * 清空已加载的插件缓存并重新扫描插件目录
   * 用于运行时新增插件后刷新插件列表
   *
   * @returns 刷新后的插件列表
   */
  async refreshPlugins(): Promise<FoundPlugin[]> {
    this.plugins.clear();
    return this.discover(true);
  }

  /**
   * 根据配置加载插件
   * 
   * 根据配置启用或禁用插件
   */
  async load(configs: PluginConfigs): Promise<void> {
    this.pluginConfigs = configs;
    const discovered = await this.discover();

    for (const found of discovered) {
      const config = configs[found.name];
      const isRunning = this.plugins.has(found.name);
      
      if (config?.isEnabled) {
        if (isRunning) {
          await this.reload(found.name, config.settings ?? {});
        } else {
          await this.enable(found.name, config.settings);
        }
      } else if (isRunning) {
        await this.disable(found.name);
      }
    }
  }

  /**
   * 启用单个插件
   */
  async enable(name: string, settings?: PluginSettings): Promise<void> {
    // 已启用则跳过
    if (this.plugins.has(name)) {
      return;
    }

    const found = (await this.discover()).find(p => p.name === name);
    if (!found) {
      throw new Error(`插件未找到: ${name}`);
    }

    // 合并默认设置和用户设置
    const mergedSettings: PluginSettings = {
      ...found.manifest.defaultSettings,
      ...settings
    };

    // 启动插件
    const plugin = await startPlugin(found, mergedSettings, {
      workspace: this.deps.workspace,
      tempDir: this.deps.tempDir,
      pluginsDir: this.deps.pluginsDir,
      getConfig: this.deps.getConfig,
      logger: this.logger,
      sendMessage: (msg, opts) => this.sendWithHooks(msg, opts)
    });

    // 注册工具到 ToolRegistry
    if (this.deps.toolRegistry) {
      for (const tool of plugin.tools) {
        this.deps.toolRegistry.register(tool, 'plugin');
      }
    }

    this.plugins.set(name, plugin);
    this.logger.info(`插件已启用`, { plugin: name, tools: plugin.tools.length });
  }

  /**
   * 禁用单个插件
   */
  async disable(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      return;
    }

    // 注销工具
    if (this.deps.toolRegistry && plugin.tools.length > 0) {
      this.deps.toolRegistry.unregisterMany(plugin.tools.map(t => t.name));
    }

    // 停止插件
    await stopPlugin(plugin, this.logger);
    this.plugins.delete(name);
    
    this.logger.info(`插件已禁用`, { plugin: name });
  }

  /**
   * 重新加载插件（配置变更后）
   */
  async reload(name: string, settings: PluginSettings): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) {
      throw new Error(`插件未运行: ${name}`);
    }

    // 保存当前状态以便回滚
    const previousSettings = { ...plugin.settings };

    try {
      await this.disable(name);
      await this.enable(name, settings);
    } catch (error) {
      this.logger.warn(`插件重载失败，回滚到之前状态`, { plugin: name, error: error instanceof Error ? error.message : String(error) });
      try {
        await this.enable(name, previousSettings);
      } catch (rollbackError) {
        this.logger.error(`插件回滚失败`, { plugin: name, error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) });
      }
      throw error;
    }
  }

  /**
   * 设置插件配置（用于初始化）
   */
  setConfigs(configs: PluginConfigs): void {
    this.pluginConfigs = configs;
  }

  /**
   * 获取当前配置
   */
  getConfigs(): PluginConfigs {
    return { ...this.pluginConfigs };
  }

  // ========== 钩子执行 ==========

  /**
   * 执行入站消息钩子链
   * 
   * 返回 null 表示消息被拦截
   */
  async transformIncomingMessage(message: InboundMessage): Promise<InboundMessage | null> {
    return runTransformChain(
      Array.from(this.plugins.values()),
      'incomingMessage',
      message,
      this.logger
    );
  }

  /**
   * 执行出站消息钩子链
   * 
   * 返回 null 表示消息被拦截
   */
  async transformOutgoingMessage(message: OutboundMessage): Promise<OutboundMessage | null> {
    return runTransformChain(
      Array.from(this.plugins.values()),
      'outgoingMessage',
      message,
      this.logger
    );
  }

  /**
   * 执行工具调用前钩子链
   */
  async beforeToolCall(info: ToolCallInfo): Promise<ToolCallInfo | null> {
    return runTransformChain(
      Array.from(this.plugins.values()),
      'beforeToolCall',
      info,
      this.logger
    );
  }

  /**
   * 执行工具调用后钩子链
   */
  async afterToolCall(info: ToolCallInfo, result: string): Promise<string> {
    return runAfterToolChain(
      Array.from(this.plugins.values()),
      info,
      result,
      this.logger
    );
  }

  /**
   * 执行 Agent 开始观察钩子
   */
  async onAgentStart(context: AgentContext): Promise<void> {
    return runObservers(
      Array.from(this.plugins.values()),
      'agentStart',
      context,
      this.logger
    );
  }

  /**
   * 执行 Agent 完成观察钩子
   */
  async onAgentComplete(context: AgentContext, response: LLMResponse): Promise<void> {
    return runAgentCompleteObservers(
      Array.from(this.plugins.values()),
      context,
      response,
      this.logger
    );
  }

  /**
   * 执行错误观察钩子
   */
  async onError(error: Error, context: PluginErrorContext): Promise<void> {
    return runObservers(
      Array.from(this.plugins.values()),
      'error',
      { error, context },
      this.logger
    );
  }

  // ========== 命令系统 ==========

  /**
   * 执行插件命令
   *
   * 按顺序尝试所有插件的命令，第一个匹配的命令执行后即返回
   */
  async _executePluginCommands(message: InboundMessage): Promise<CommandResult | null> {
    const content = message.content?.trim() ?? '';

    if (!content) {
      return null;
    }

    // 按 order 排序
    const sortedPlugins = Array.from(this.plugins.values())
      .sort((a, b) => a.order - b.order);

    for (const plugin of sortedPlugins) {
      for (const command of plugin.commands) {
        if (!command.pattern) continue;

        const { matched, args } = matchCommand(content, command.pattern);

        if (!matched) continue;

        try {
          const result = await command.execute(message, args);

          if (result) {
            return result;
          }

          // 返回 null 表示已处理
          return { resultType: 'handled' };
        } catch (error) {
          this.logger.warn(`命令执行失败`, {
            plugin: plugin.name,
            command: command.commandName,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return null;
  }

  // ========== 查询方法 ==========

  /**
   * 列出所有插件（包括未启用的）
   */
  async list(): Promise<PluginMetadata[]> {
    const discovered = await this.discover();
    
    return discovered.map(found => {
      const running = this.plugins.get(found.name);
      const config = this.pluginConfigs[found.name];
      
      return {
        name: found.name,
        version: found.manifest.version,
        description: found.manifest.description,
        author: found.manifest.author,
        isEnabled: running !== undefined,
        settings: config?.settings ?? found.manifest.defaultSettings,
        defaultSettings: found.manifest.defaultSettings,
        defaultEnabled: found.manifest.defaultEnabled,
        toolCount: running?.tools.length ?? found.manifest.advertisedToolCount ?? 0
      };
    });
  }

  /**
   * 获取单个插件信息
   */
  async get(name: string): Promise<PluginMetadata | undefined> {
    const all = await this.list();
    return all.find(p => p.name === name);
  }

  /**
   * 检查插件是否已启用
   */
  isEnabled(name: string): boolean {
    return this.plugins.has(name);
  }

  // ========== 私有方法 ==========

  /**
   * 发送消息（经过出站消息钩子）
   */
  private async sendWithHooks(message: OutboundMessage, options?: SendOptions): Promise<void> {
    if (options?.skipHooks) {
      await this.deps.outboundPublisher(message);
      return;
    }

    const processed = await this.transformOutgoingMessage(message);
    
    if (processed === null) {
      // 被钩子拦截
      return;
    }

    await this.deps.outboundPublisher(processed);
  }

  // ========== Worker 兼容方法 ==========

  /**
   * Worker 兼容：执行工具调用前钩子
   */
  async runToolBeforeHooks(input: { toolName: string; params: Record<string, unknown>; context?: import('../../../platform/tools/ToolRegistry.js').ToolContext }): Promise<{ params: Record<string, unknown>; context?: import('../../../platform/tools/ToolRegistry.js').ToolContext }> {
    const info: ToolCallInfo = {
      toolName: input.toolName,
      params: input.params,
      context: input.context
    };
    const result = await this.beforeToolCall(info);
    if (result === null) {
      return { params: input.params, context: input.context };
    }
    return { params: result.params, context: result.context };
  }

  /**
   * Worker 兼容：执行工具调用后钩子
   */
  async runToolAfterHooks(input: { toolName: string; params: Record<string, unknown>; result: string; context?: import('../../../platform/tools/ToolRegistry.js').ToolContext }): Promise<{ result: string }> {
    const info: ToolCallInfo = {
      toolName: input.toolName,
      params: input.params,
      context: input.context
    };
    const result = await this.afterToolCall(info, input.result);
    return { result };
  }

  // ========== PluginManager 接口实现 ==========

  async runAgentBeforeTaps(input: { message: InboundMessage; messages: unknown[] }): Promise<void> {
    const context: AgentContext = {
      message: input.message,
      messages: input.messages as any
    };
    await this.onAgentStart(context);
  }

  async runAgentAfterTaps(input: { message: InboundMessage; response: unknown }): Promise<void> {
    const context: AgentContext = {
      message: input.message,
      messages: []
    };
    await this.onAgentComplete(context, input.response as LLMResponse);
  }

  async runErrorTaps(error: unknown, context: PluginErrorContext): Promise<void> {
    await this.onError(error instanceof Error ? error : new Error(String(error)), context);
  }

  async dispatchMessage(message: OutboundMessage, options?: { skipHooks?: boolean }): Promise<void> {
    await this.sendWithHooks(message, options);
  }

  async runCommands(message: InboundMessage): Promise<{ type: 'reply'; message: InboundMessage } | { type: 'handled' } | null> {
    const result = await this._executePluginCommands(message);
    if (!result) {
      return null;
    }
    if (result.resultType === 'handled') {
      return { type: 'handled' };
    }
    return { type: 'reply', message: result.message };
  }

  async executeCommand(message: InboundMessage): Promise<{ resultType: 'modified'; message: InboundMessage } | { resultType: 'handled' } | null> {
    const result = await this._executePluginCommands(message);
    if (!result) {
      return null;
    }
    if (result.resultType === 'handled') {
      return { resultType: 'handled' };
    }
    return { resultType: 'modified', message: result.message };
  }

  async runMessageInHooks(message: InboundMessage): Promise<InboundMessage | null> {
    return this.transformIncomingMessage(message);
  }
}
