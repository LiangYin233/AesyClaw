/** @file 插件系统核心类型定义
 *
 * 定义插件接口、钩子生命周期、钩子载荷与分发结果等类型，
 * 是插件开发者与运行时之间的核心合约。
 */

import type { ScopedLogger } from '@/platform/observability/logger.js';
import type { ChannelReceiveMessage, ChannelSendMessage } from '@/agent/types.js';
import type { ChannelSendPayload } from '@/channels/channel-plugin.js';
import type { PluginCommandRegistrar } from '@/contracts/commands.js';
import type { StandardMessage } from '@/platform/llm/types.js';
import type { ToolExecutionResult } from '@/platform/tools/types.js';
import type { ToolRegistrationPort } from '@/platform/tools/registry.js';

/** 插件工具执行上下文，携带当前会话与发送者的标识 */
export interface PluginToolExecuteContext {
    chatId: string;
    senderId: string;
    [key: string]: unknown;
}

/** 工具参数中单个属性的定义，用于描述 JSON Schema 风格的参数结构 */
export interface ParameterDefinition {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description?: string;
    items?: ParameterDefinition;
    properties?: Record<string, ParameterDefinition>;
    required?: string[];
    [key: string]: unknown;
}

/** 插件注册的工具定义，包含参数 schema 与执行函数 */
export interface PluginToolDefinition {
    name: string;
    description: string;
    parameters: {
        type: 'object';
        properties: Record<string, ParameterDefinition>;
        required?: string[];
        [key: string]: unknown;
    };
    execute: (
        _args: unknown,
        _context: PluginToolExecuteContext,
    ) => Promise<{ success: boolean; content: string; error?: string }>;
}

/** 插件专属日志器，自动携带插件名称前缀 */
export type PluginLogger = ScopedLogger;

/** 插件初始化时接收的上下文对象
 *
 * 通过此上下文，插件可以读取合并后的配置、注册工具与命令、
 * 以及在频道插件场景下通过 send 回发消息。
 */
export interface PluginContext<TOptions = Record<string, unknown>> {
    /** 带插件名称前缀的日志器 */
    logger: PluginLogger;
    /** 经 defaultOptions 与用户配置合并后的最终配置 */
    config: TOptions;
    /** 工具注册作用域，可注册/注销/列出/释放工具 */
    tools: PluginToolRegistrar;
    /** 命令注册作用域，可注册/注销/列出/释放命令 */
    commands: PluginCommandRegistrar;
    /** 向当前频道回发消息（仅频道插件场景可用） */
    send?: (_payload: ChannelSendPayload) => Promise<void>;
    /** 当前频道标识（仅频道插件场景可用） */
    channelId?: string;
}

/** 插件可使用的工具注册端口，取自 ToolRegistrationPort 的安全子集 */
export type PluginToolRegistrar = Pick<
    ToolRegistrationPort,
    'register' | 'unregister' | 'listOwnedNames' | 'dispose'
>;

/** beforeLLMRequest 钩子载荷中的工具描述 */
export interface HookPayloadLLMTool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** beforeLLMRequest 钩子载荷中的技能描述 */
export interface HookPayloadLLMSkill {
    name: string;
    description: string;
    metadata: Record<string, unknown>;
}

/** onReceive 钩子的载荷，包含收到的频道消息 */
export interface HookPayloadReceive {
    message: ChannelReceiveMessage;
}

/** beforeLLMRequest 钩子的载荷，包含即将发送给 LLM 的消息、工具与技能列表 */
export interface HookPayloadBeforeLLMRequest {
    messages: ReadonlyArray<StandardMessage>;
    tools: HookPayloadLLMTool[];
    skills: HookPayloadLLMSkill[];
}

/** beforeToolCall / afterToolCall 钩子中的工具调用信息 */
export interface HookPayloadToolCall {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}

/** afterToolCall 钩子的载荷，包含工具调用及其执行结果 */
export interface HookPayloadAfterToolCall {
    toolCall: HookPayloadToolCall;
    result: {
        success: boolean;
        content: string;
        error?: string;
    };
}

/** onSend 钩子的载荷，包含即将发送的频道消息（含 chatId） */
export interface HookPayloadSend {
    message: ChannelSendMessage & { chatId: string };
}

/** 钩子通用结果：阻止后续处理，可附带原因说明 */
export interface HookBlockResult {
    action: 'block';
    reason?: string;
}

/** 钩子通用结果：继续处理，并携带可能被修改后的值 */
export interface HookContinueResult<T> {
    action: 'continue';
    value: T;
}

/** beforeToolCall 专用结果：短路本次工具调用，直接返回指定结果 */
export interface HookShortCircuitResult {
    action: 'shortCircuit';
    result: ToolExecutionResult;
}

/** onReceive 钩子返回类型：允许修改消息后继续，或阻止消息进入后续流水线 */
export type HookReceiveResult = HookContinueResult<ChannelReceiveMessage> | HookBlockResult;

/** onSend 钩子返回类型：允许修改发送内容后继续，或阻止消息发出 */
export type HookSendResult =
    | HookContinueResult<ChannelSendMessage & { chatId: string }>
    | HookBlockResult;

/** beforeLLMRequest 钩子返回类型：允许请求继续，或阻止 LLM 调用 */
export type HookBeforeLLMRequestResult = { action: 'continue' } | HookBlockResult;

/** beforeToolCall 钩子返回类型：允许工具执行，或短路并返回自定义结果 */
export type HookBeforeToolCallResult = { action: 'continue' } | HookShortCircuitResult;

/** afterToolCall 钩子返回类型：携带可被修改后的工具执行结果 */
export type HookAfterToolCallResult = HookContinueResult<ToolExecutionResult>;

/** onReceive 分发结果：消息被阻止或放行（可能已被修改） */
export type ReceiveDispatchResult =
    | { blocked: true; reason?: string }
    | { blocked: false; message: HookPayloadReceive['message'] };

/** onSend 分发结果：消息被阻止或放行（可能已被修改） */
export type SendDispatchResult =
    | { blocked: true; reason?: string }
    | { blocked: false; message: HookPayloadSend['message'] };

/** beforeLLMRequest 分发结果：请求被阻止或放行 */
export type BeforeLLMRequestDispatchResult =
    | { blocked: true; reason?: string }
    | { blocked: false };

/** beforeToolCall 分发结果：工具调用被短路或正常执行 */
export type BeforeToolCallDispatchResult =
    | { shortCircuited: true; result: ToolExecutionResult }
    | { shortCircuited: false };

/** 插件钩子集合
 *
 * 每个钩子在消息生命周期的不同阶段被调用，执行顺序为：
 * 1. onReceive   — 收到频道消息后、进入流水线前
 * 2. beforeLLMRequest — 构造 LLM 请求后、发送给模型前
 * 3. beforeToolCall   — LLM 请求工具调用时、实际执行前
 * 4. afterToolCall    — 工具执行完毕后、结果返回给 LLM 前
 * 5. onSend      — LLM 生成回复后、发送给频道前
 *
 * 任一钩子返回 block 即终止后续处理；beforeToolCall 可返回 shortCircuit
 * 跳过实际工具执行。
 */
export interface PluginHooks {
    /** 收到频道消息时触发，可修改或阻止消息进入后续流水线 */
    onReceive?: (_payload: HookPayloadReceive) => Promise<HookReceiveResult>;
    /** 构造 LLM 请求后触发，可阻止请求发送给模型 */
    beforeLLMRequest?: (
        _payload: HookPayloadBeforeLLMRequest,
    ) => Promise<HookBeforeLLMRequestResult>;
    /** 工具调用执行前触发，可短路并返回自定义结果 */
    beforeToolCall?: (_toolCall: HookPayloadToolCall) => Promise<HookBeforeToolCallResult>;
    /** 工具调用执行后触发，可修改工具执行结果 */
    afterToolCall?: (_payload: HookPayloadAfterToolCall) => Promise<HookAfterToolCallResult>;
    /** 回复消息发送前触发，可修改或阻止消息发出 */
    onSend?: (_payload: HookPayloadSend) => Promise<HookSendResult>;
}

/** 插件定义
 *
 * 每个插件目录（plugin_*）下需要导出此接口的实现。
 * 运行时按以下生命周期管理插件：
 * 1. 扫描 plugin_* 目录并加载入口模块
 * 2. 调用 init() 传入上下文，插件在此注册工具/命令/钩子
 * 3. 运行期间通过 PluginHooks 参与消息处理
 * 4. 卸载时调用 destroy() 释放资源
 */
export interface Plugin<TOptions = Record<string, unknown>> {
    /** 插件唯一标识名称 */
    name: string;
    /** 语义化版本号 */
    version: string;
    /** 插件功能描述 */
    description?: string;
    /** 默认配置项，会与用户配置合并后传入 init() 的 config */
    defaultOptions?: TOptions;
    /** 初始化回调，插件在此注册工具、命令及设置钩子 */
    init?: (_ctx: PluginContext<TOptions>) => Promise<void>;
    /** 钩子集合，定义插件在消息生命周期各阶段的行为 */
    hooks?: PluginHooks;
    /** 销毁回调，插件卸载时调用以释放资源 */
    destroy?: () => Promise<void>;
}

/** 已加载插件的摘要信息 */
export interface PluginInfo {
    name: string;
    description?: string;
    version: string;
    loaded: boolean;
    hooks: string[];
    commands?: number;
}
