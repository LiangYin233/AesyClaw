/** @file 插件钩子分发接口
 *
 * 定义 PluginHookRuntime 接口，是消息处理流水线与插件系统之间的桥梁。
 * Pipeline 在消息生命周期的关键节点调用此接口，
 * PluginManager 实现此接口以将钩子调用分发给各已加载插件。
 *
 * 分发顺序：按插件加载顺序依次调用，任一插件返回 block/shortCircuit 即终止后续分发。
 */

import type {
    BeforeLLMRequestDispatchResult,
    BeforeToolCallDispatchResult,
    ReceiveDispatchResult,
    SendDispatchResult,
    HookPayloadReceive,
    HookPayloadSend,
    HookPayloadBeforeLLMRequest,
    HookPayloadToolCall,
    HookPayloadAfterToolCall,
} from '@/features/plugins/types.js';
import type { ToolExecutionResult } from '@/platform/tools/types.js';

/** 插件钩子分发接口
 *
 * 流水线通过此接口与插件系统交互，
 * 每个方法对应消息生命周期的一个阶段。
 */
export interface PluginHookRuntime {
    /** 分发 onReceive 钩子：收到频道消息时 */
    dispatchReceive(payload: HookPayloadReceive): Promise<ReceiveDispatchResult>;

    /** 分发 onSend 钩子：发送回复前 */
    dispatchSend(payload: HookPayloadSend): Promise<SendDispatchResult>;

    /** 分发 beforeLLMRequest 钩子：发送 LLM 请求前 */
    dispatchBeforeLLMRequest(
        payload: HookPayloadBeforeLLMRequest,
    ): Promise<BeforeLLMRequestDispatchResult>;

    /** 分发 beforeToolCall 钩子：工具执行前 */
    dispatchBeforeToolCall(toolCall: HookPayloadToolCall): Promise<BeforeToolCallDispatchResult>;

    /** 分发 afterToolCall 钩子：工具执行后 */
    dispatchAfterToolCall(payload: HookPayloadAfterToolCall): Promise<ToolExecutionResult>;
}
