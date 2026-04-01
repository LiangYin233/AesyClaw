/**
 * Plugins 核心类型定义
 * 
 * 包含插件系统所需的所有类型定义，包括：
 * - 插件清单（PluginManifest）
 * - 插件API（PluginAPI）
 * - 运行中的插件（RunningPlugin）
 * - 命令和钩子处理器类型
 */

import type { InboundMessage, OutboundMessage, PluginErrorContext, Config, LLMResponse } from '../../../../types.js';
import type { Tool, ToolContext } from '../../../../platform/tools/ToolRegistry.js';
import type { Logger } from '../../../../platform/observability/index.js';

// ========== 基础类型 ==========

/** 插件设置（任意键值对） */
export type PluginSettings = Record<string, unknown>;

/** 清理函数（插件停用时调用） */
export type CleanupFunction = () => Promise<void> | void;

/** 发送消息选项 */
export interface SendOptions {
  /** 是否跳过出站消息钩子 */
  skipHooks?: boolean;
}

// ========== 命令系统 ==========

/** 命令匹配模式 */
export type CommandPattern = 
  | { matchStyle: 'regex'; pattern: RegExp }      // 正则匹配，提取捕获组
  | { matchStyle: 'exact'; text: string }         // 精确匹配
  | { matchStyle: 'prefix'; prefix: string }      // 前缀匹配
  | { matchStyle: 'contains'; keyword: string };  // 包含匹配

/** 命令结果 */
export type CommandResult = 
  | { resultType: 'modified'; message: InboundMessage }  // 修改后的消息
  | { resultType: 'handled' };                           // 已处理，停止传播

/** 插件命令处理器 */
export interface PluginCommand {
  commandName: string;           // 命令名称，用于日志
  description: string;           // 命令描述，用于帮助文档
  pattern?: CommandPattern;      // 匹配模式（可选）
  execute(message: InboundMessage, args: string[]): Promise<CommandResult | null> | CommandResult | null;
}

// ========== 钩子处理器类型 ==========

/** 转换处理器（可修改值或返回 null 中断） */
export type TransformHandler<T> = (value: T) => Promise<T | null> | T | null;

/** 观察处理器（只读，不能修改或中断） */
export type ObserverHandler<T> = (value: T) => Promise<void> | void;

/** 工具调用前信息 */
export interface ToolCallInfo {
  toolName: string;
  params: Record<string, unknown>;
  context?: ToolContext;
}

/** Agent 上下文 */
export interface AgentContext {
  message: InboundMessage;
  messages: unknown[];
}

// ========== 钩子集合 ==========

/** 插件钩子集合（7个钩子） */
export interface PluginHookRegistry {
  incomingMessage: TransformHandler<InboundMessage>[];      // 入站消息转换
  outgoingMessage: TransformHandler<OutboundMessage>[];     // 出站消息转换
  beforeToolCall: TransformHandler<ToolCallInfo>[];         // 工具调用前转换
  afterToolCall: Array<(info: ToolCallInfo, result: string) => Promise<string> | string>;  // 工具调用后转换
  agentStart: ObserverHandler<AgentContext>[];              // Agent 开始观察
  agentComplete: Array<(ctx: AgentContext, response: LLMResponse) => Promise<void> | void>;  // Agent 完成观察
  error: ObserverHandler<{ error: Error; context: PluginErrorContext }>[];  // 错误观察
}

// ========== 插件API（传给插件的上下文） ==========

/** 工具注册API */
export interface ToolRegistryAPI {
  register(tool: Tool): void;
}

/** 命令注册API */
export interface CommandRegistryAPI {
  register(command: PluginCommand): void;
}

/** 钩子注册API */
export interface HookRegistryAPI {
  incomingMessage: { transform(handler: TransformHandler<InboundMessage>): void };
  outgoingMessage: { transform(handler: TransformHandler<OutboundMessage>): void };
  beforeToolCall: { transform(handler: TransformHandler<ToolCallInfo>): void };
  afterToolCall: { transform(handler: (info: ToolCallInfo, result: string) => Promise<string> | string): void };
  agentStart: { observe(handler: ObserverHandler<AgentContext>): void };
  agentComplete: { observe(handler: (ctx: AgentContext, response: LLMResponse) => Promise<void> | void): void };
  error: { observe(handler: ObserverHandler<{ error: Error; context: PluginErrorContext }>): void };
}

/** 插件API（插件通过此API与系统交互） */
export interface PluginAPI {
  /** 系统配置（启动时的快照，只读） */
  readonly config: Readonly<Config>;
  
  /** 插件当前设置 */
  readonly settings: PluginSettings;
  
  /** 工作区目录 */
  readonly workspace: string;
  
  /** 临时文件目录 */
  readonly tempDir: string;
  
  /** 插件专属日志记录器 */
  readonly logger: Logger;
  
  /** 注册工具 */
  readonly tools: ToolRegistryAPI;
  
  /** 注册命令 */
  readonly commands: CommandRegistryAPI;
  
  /** 注册钩子 */
  readonly hooks: HookRegistryAPI;
  
  /** 发送消息 */
  send(message: OutboundMessage, options?: SendOptions): Promise<void>;
}

// ========== 插件清单 ==========

/** 插件清单（插件导出此对象） */
export interface PluginManifest {
  /** 插件名称（唯一标识） */
  name: string;
  
  /** 版本号 */
  version: string;
  
  /** 功能描述 */
  description?: string;
  
  /** 作者信息 */
  author?: string;
  
  /** 默认是否启用 */
  defaultEnabled?: boolean;
  
  /** 默认设置 */
  defaultSettings?: PluginSettings;
  
  /** 声明的工具数量（用于UI展示） */
  advertisedToolCount?: number;
  
  /** 初始化函数（插件入口） */
  setup(api: PluginAPI): Promise<void | CleanupFunction> | void | CleanupFunction;
}

// ========== 内部类型 ==========

/** 已发现的插件（扫描阶段） */
export interface FoundPlugin {
  name: string;                  // 插件名称（目录名）
  sourcePath: string;            // 源码文件路径
  order: number;                 // 加载顺序
  manifest: PluginManifest;      // 插件清单
}

/** 运行中的插件（已初始化） */
export interface RunningPlugin {
  name: string;
  order: number;
  manifest: PluginManifest;
  settings: PluginSettings;
  tools: Tool[];
  commands: PluginCommand[];
  hooks: PluginHookRegistry;
  cleanup?: CleanupFunction;
}

/** 插件配置状态 */
export interface PluginConfigEntry {
  enabled?: boolean;
  options?: PluginSettings;
}

/** 插件配置集合 */
export type PluginConfigs = Record<string, PluginConfigEntry>;

/** 插件元数据（对外展示） */
export interface PluginMetadata {
  name: string;
  version: string;
  description?: string;
  author?: string;
  enabled: boolean;
  settings?: PluginSettings;
  defaultSettings?: PluginSettings;
  defaultEnabled?: boolean;
  toolCount: number;
}

// ========== 配置转换函数 ==========

type RawPluginConfigEntry = { enabled?: boolean; options?: Record<string, unknown> } | { isEnabled?: boolean; settings?: Record<string, unknown> } | unknown;

export function normalizePluginConfigs(rawConfigs: Record<string, RawPluginConfigEntry> | undefined): PluginConfigs {
  if (!rawConfigs) {
    return {};
  }

  const result: PluginConfigs = {};

  for (const [name, entry] of Object.entries(rawConfigs)) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const e = entry as Record<string, unknown>;
    const enabled = (e.enabled as boolean | undefined) ?? (e.isEnabled as boolean | undefined);
    const options = (e.options ?? e.settings) as Record<string, unknown> | undefined;

    result[name] = {
      enabled,
      options: options ? { ...options } : undefined
    };
  }

  return result;
}
