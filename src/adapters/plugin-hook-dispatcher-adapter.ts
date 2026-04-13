import type {
  HookPayloadMessageReceive,
  HookPayloadBeforeLLMRequest,
  HookPayloadToolCall,
  HookPayloadAfterToolCall,
  HookPayloadMessageSend,
} from '../features/plugins/types.js';
import { pluginManager } from '../features/plugins/plugin-manager.js';

export class PluginHookDispatcherAdapter {
  async dispatchMessageReceive(payload: HookPayloadMessageReceive): Promise<HookPayloadMessageReceive['message'] | null> {
    return pluginManager.dispatchMessageReceive(payload);
  }

  async dispatchBeforeLLMRequest(payload: HookPayloadBeforeLLMRequest): Promise<void> {
    await pluginManager.dispatchBeforeLLMRequest(payload);
  }

  async dispatchBeforeToolCall(toolCall: HookPayloadToolCall): Promise<{ success: boolean; content: string; error?: string } | null> {
    return pluginManager.dispatchBeforeToolCall(toolCall);
  }

  async dispatchAfterToolCall(payload: HookPayloadAfterToolCall): Promise<HookPayloadAfterToolCall['result']> {
    return pluginManager.dispatchAfterToolCall(payload);
  }

  async dispatchMessageSend(payload: HookPayloadMessageSend): Promise<HookPayloadMessageSend['message'] | null> {
    return pluginManager.dispatchMessageSend(payload);
  }
}

export const pluginHookDispatcherAdapter = new PluginHookDispatcherAdapter();
