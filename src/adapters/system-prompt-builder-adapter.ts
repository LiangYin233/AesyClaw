import type { ISystemPromptBuilder } from '../contracts/system-prompt-builder.js';
import { systemPromptManager } from '../features/roles/system-prompt-manager.js';

export class SystemPromptBuilderAdapter implements ISystemPromptBuilder {
  buildSystemPrompt(params: { roleId: string; chatId: string; toolDescriptions?: string; skillInstructions?: string; sessionMemory?: string }): string {
    return systemPromptManager.buildSystemPrompt({
      roleId: params.roleId,
      chatId: params.chatId,
    });
  }
}

export const systemPromptBuilderAdapter = new SystemPromptBuilderAdapter();
