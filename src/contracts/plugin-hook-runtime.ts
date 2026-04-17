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

export interface PluginHookRuntime {
  dispatchReceive(
    payload: HookPayloadReceive
  ): Promise<ReceiveDispatchResult>;

  dispatchSend(
    payload: HookPayloadSend
  ): Promise<SendDispatchResult>;

  dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<BeforeLLMRequestDispatchResult>;

  dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<BeforeToolCallDispatchResult>;

  dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<ToolExecutionResult>;
}
