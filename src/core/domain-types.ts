import type { SessionKey, ToolOwner } from './identity-types';

/** 工具权限过滤模式 */
export type ToolPermissionMode = 'allowlist' | 'denylist';

export type ToolPermissionConfig = {
  mode: ToolPermissionMode;
  list: string[];
}

export type RoleConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermissionConfig;
  skills: string[] | ['*'];
  enabled: boolean;
}

export type Skill = {
  name: string;
  description: string;
  content: string;
  isSystem: boolean;
  filePath: string;
}

/** 提供给命令执行函数的上下文 */
export type CommandContext = {
  sessionKey: SessionKey;
}

/** 可注册到 CommandRegistry 的命令 */
export type CommandDefinition = {
  name: string;
  namespace?: string;
  description: string;
  usage?: string;
  allowDuringAgentProcessing?: boolean;
  /** 用于清理的所属子系统作用域；值格式与 ToolOwner 相同。 */
  scope: ToolOwner;
  execute: CommandExecuteFn;
}

/** 命令执行函数签名 */
export type CommandExecuteFn = (args: string[], context: CommandContext) => Promise<string>;
