import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import type { HookDispatcher } from '@aesyclaw/pipeline/hook-dispatcher';
import type { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { DatabaseManager } from '@aesyclaw/core/database/database-manager';
import { createHelpCommand } from './help';
import { createClearCommand } from './clear';
import { createCompactCommand } from './compact';
import { createStopCommand } from './stop';
import { createBtwCommand } from './btw';
import { createModelCommand } from './model';
import {
  createRoleListCommand,
  createRoleSwitchCommand,
  createRoleInfoCommand,
} from './role-commands';
import {
  createPluginListCommand,
  createPluginEnableCommand,
  createPluginDisableCommand,
} from './plugin-commands';

export type BuiltinCommandDependencies = {
  roleManager: RoleManager;
  pluginManager: Pick<ExtensionManager, 'listPlugins' | 'enablePlugin' | 'disablePlugin'>;
  sessionManager: Pick<SessionManager, 'create' | 'clear' | 'get'>;
  llmAdapter: LlmAdapter;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  hookDispatcher: HookDispatcher;
  databaseManager: Pick<DatabaseManager, 'roleBindings' | 'sessions'>;
};

export function registerBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  const roleDeps: RoleCommandDeps = {
    roleManager: deps.roleManager,
    databaseManager: deps.databaseManager,
  };
  const pluginDeps: PluginCommandDeps = { extensionManager: deps.pluginManager };

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
      deps.hookDispatcher,
      deps.databaseManager,
    ),
  );
  registry.register(createModelCommand(deps.llmAdapter));
  registry.register(createClearCommand(deps.sessionManager));
  registry.register(
    createCompactCommand(
      deps.sessionManager,
      deps.llmAdapter,
      deps.roleManager,
      deps.databaseManager,
    ),
  );
  registry.register(createStopCommand(deps.sessionManager));
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}
