import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { SessionManager } from '@aesyclaw/session';
import type { RoleManager } from '@aesyclaw/role/manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm/adapter';
import type { SkillManager } from '@aesyclaw/skill/manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { IHooksBus } from '@aesyclaw/hook';
import type { PluginManager } from '@aesyclaw/extension/plugin/manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import type { AgentRegistry } from '@aesyclaw/agent/registry';
import { createHelpCommand } from './help';
import { createClearCommand } from './clear';
import { createCompactCommand } from './compact';
import { createStopCommand } from './stop';
import { createBtwCommand } from './btw';
import { createModelCommand } from './model';
import * as pluginCommands from './plugin-commands';
import * as roleCommands from './role-commands';
import { createSkillReloadCommand } from './skill-commands';

/** 注册内置命令所需的完整依赖集合。 */
export type BuiltinCommandDependencies = {
  roleManager: RoleManager;
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
  sessionManager: Pick<SessionManager, 'create' | 'clear' | 'delete' | 'get'>;
  llmAdapter: LlmAdapter;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hooksBus: IHooksBus;
  databaseManager: Pick<DatabaseManager, 'sessions'>;
  compressionThreshold: number;
  agentRegistry: AgentRegistry;
  defaultModel: string;
};

/**
 * 向命令注册表中注册所有内置命令。
 * @param registry - 命令注册表
 * @param deps - 内置命令所需的依赖集合
 */
export function registerBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  const roleDeps: roleCommands.RoleCommandDeps = {
    roleManager: deps.roleManager,
    databaseManager: deps.databaseManager,
    agentRegistry: deps.agentRegistry,
  };
  const pluginDeps: pluginCommands.PluginCommandDeps = { pluginManager: deps.pluginManager };

  registry.register(createHelpCommand(() => registry.getAll()));
  registry.register(
    createBtwCommand(
      deps.sessionManager,
      (roleId) => deps.roleManager.getRole(roleId),
      () => deps.roleManager.getDefaultRole(),
      deps.llmAdapter,
      deps.roleManager,
      deps.skillManager,
      deps.toolRegistry,
      deps.hooksBus,
      deps.databaseManager,
      deps.compressionThreshold,
      deps.agentRegistry,
      deps.defaultModel,
    ),
  );
  registry.register(createModelCommand(deps.llmAdapter, deps.agentRegistry, deps.databaseManager));
  registry.register(createClearCommand(deps.sessionManager, deps.agentRegistry));
  registry.register(
    createCompactCommand(
      deps.sessionManager,
      deps.llmAdapter,
      deps.databaseManager,
      deps.defaultModel,
    ),
  );
  registry.register(createStopCommand(deps.sessionManager, deps.agentRegistry));
  registry.register(roleCommands.createRoleListCommand(roleDeps));
  registry.register(roleCommands.createRoleSwitchCommand(roleDeps));
  registry.register(roleCommands.createRoleInfoCommand(roleDeps));
  registry.register(pluginCommands.createPluginListCommand(pluginDeps));
  registry.register(pluginCommands.createPluginEnableCommand(pluginDeps));
  registry.register(pluginCommands.createPluginDisableCommand(pluginDeps));
  registry.register(createSkillReloadCommand(deps.skillManager, deps.agentRegistry));
}
