import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { PluginManager } from '@aesyclaw/extension/plugin/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import type { AgentFactory } from '@aesyclaw/agent/agent-factory';

/** 注册内置命令所需的完整依赖集合。 */
export type BuiltinCommandDependencies = {
  roleManager: RoleManager;
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
  sessionManager: Pick<SessionManager, 'create' | 'clearById' | 'deleteById' | 'get'>;
  llmAdapter: LlmAdapter;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  databaseManager: Pick<DatabaseManager, 'sessions'>;
  compressionThreshold: number;
  agentRegistry: AgentRegistry;
  agentFactory: AgentFactory;
};
