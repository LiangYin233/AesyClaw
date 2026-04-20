/** @file 插件相关类型的 SDK 公共导出
 *
 * 供插件开发者 import 使用的统一入口，将内部类型重新导出。
 * 使用方式：`import type { Plugin, PluginContext } from '@/sdk/plugin.js'`
 */
export type {
    BeforeLLMRequestDispatchResult,
    BeforeToolCallDispatchResult,
    HookAfterToolCallResult,
    HookBeforeLLMRequestResult,
    HookBeforeToolCallResult,
    HookBlockResult,
    HookContinueResult,
    HookReceiveResult,
    HookSendResult,
    HookShortCircuitResult,
    ReceiveDispatchResult,
    SendDispatchResult,
    Plugin,
    PluginContext,
    PluginInfo,
    PluginHooks,
    PluginToolDefinition,
    PluginToolExecuteContext,
    HookPayloadLLMTool,
    HookPayloadLLMSkill,
    HookPayloadReceive,
    HookPayloadBeforeLLMRequest,
    HookPayloadToolCall,
    HookPayloadAfterToolCall,
    HookPayloadSend,
} from '@/features/plugins/types.js';
