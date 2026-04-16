import type {
  BeforeLLMRequestDispatchResult,
  BeforeToolCallDispatchResult,
  MessageReceiveDispatchResult,
  MessageSendDispatchResult,
  HookPayloadMessageReceive,
  HookPayloadMessageSend,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
} from '@/features/plugins/types.js';
import type { ToolExecutionResult } from '@/platform/tools/types.js';

export interface IPluginHookRuntime {
  dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<MessageReceiveDispatchResult>;

  dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<MessageSendDispatchResult>;

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
