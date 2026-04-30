import type { SessionKey, ToolOwner } from './identity-types';

/** Tool permission filtering mode */
export type ToolPermissionMode = 'allowlist' | 'denylist';

export interface ToolPermissionConfig {
  mode: ToolPermissionMode;
  list: string[];
}

export interface RoleConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermissionConfig;
  skills: string[] | ['*'];
  enabled: boolean;
}

export interface Skill {
  name: string;
  description: string;
  content: string;
  isSystem: boolean;
  filePath: string;
}

/** Context provided to command execute functions */
export interface CommandContext {
  sessionKey: SessionKey;
}

/** A command that can be registered with the CommandRegistry */
export interface CommandDefinition {
  name: string;
  namespace?: string;
  description: string;
  usage?: string;
  allowDuringAgentProcessing?: boolean;
  /** Owning subsystem scope used for cleanup; same value format as ToolOwner. */
  scope: ToolOwner;
  execute: CommandExecuteFn;
}

/** Command execute function signature */
export type CommandExecuteFn = (args: string[], context: CommandContext) => Promise<string>;
