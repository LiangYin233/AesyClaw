import { SessionRegistry } from '@/agent/session/session-registry.js';
import type { IConfigManager } from '@/contracts/config-manager.js';
import type { IRoleManager } from '@/contracts/role-manager.js';
import type { ISystemPromptBuilder } from '@/contracts/system-prompt-builder.js';
import { configManager } from '@/features/config/config-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { systemPromptManager } from '@/features/roles/system-prompt-manager.js';

let sessionRegistryInstance: SessionRegistry | null = null;

export type { SessionRegistry };

export function getSessionRegistry(): SessionRegistry {
  if (!sessionRegistryInstance) {
    sessionRegistryInstance = new SessionRegistry({
      configManager: configManager as unknown as IConfigManager,
      roleManager: roleManager as unknown as IRoleManager,
      systemPromptBuilder: systemPromptManager as unknown as ISystemPromptBuilder,
    });
  }

  return sessionRegistryInstance;
}

export const sessionRegistry = getSessionRegistry();
