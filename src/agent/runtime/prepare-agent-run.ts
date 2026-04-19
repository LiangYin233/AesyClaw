import type { FullConfig } from '@/features/config/schema.js';
import { roleManager } from '@/features/roles/role-manager.js';
import type { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { DEFAULT_ROLE_ID } from '@/features/roles/types.js';
import type { LLMConfig } from '@/platform/llm/types.js';
import { resolveLLMConfig } from './resolve-llm-config.js';

export interface PreparedAgentRun {
  llmConfig: LLMConfig;
  systemPrompt: string;
  modelIdentifier: string;
}

export function prepareAgentRun(
  chatId: string,
  config: FullConfig,
  systemPromptManager: Pick<SystemPromptManager, 'buildSystemPrompt'>,
  roleId: string = DEFAULT_ROLE_ID
): PreparedAgentRun {
  const roleConfig = roleManager.getRoleConfig(roleId);
  const modelIdentifier = roleConfig.model;
  const systemPrompt = systemPromptManager.buildSystemPrompt({
    roleId,
    chatId,
  });

  return {
    llmConfig: resolveLLMConfig(modelIdentifier, config),
    systemPrompt,
    modelIdentifier,
  };
}
