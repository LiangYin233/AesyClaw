import type {
  HookPayloadMessageReceive,
  HookPayloadMessageSend,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
} from '@/features/plugins/types.js';

export interface IPluginHookRuntime {
  dispatchMessageReceive(
    payload: HookPayloadMessageReceive
  ): Promise<HookPayloadMessageReceive['message'] | null>;

  dispatchMessageSend(
    payload: HookPayloadMessageSend
  ): Promise<HookPayloadMessageSend['message'] | null>;

  dispatchBeforeLLMRequest(
    payload: HookPayloadBeforeLLMRequest
  ): Promise<void>;

  dispatchBeforeToolCall(
    toolCall: HookPayloadToolCall
  ): Promise<{ success: boolean; content: string; error?: string } | null>;

  dispatchAfterToolCall(
    payload: HookPayloadAfterToolCall
  ): Promise<HookPayloadAfterToolCall['result']>;
}
