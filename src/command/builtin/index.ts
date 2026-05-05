import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
import type { SessionManager } from '@aesyclaw/agent/session/manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';
import type { ExtensionManager } from '@aesyclaw/extension/extension-manager';
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
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole' | 'getDefaultRole'>;
  pluginManager: Pick<ExtensionManager, 'listPlugins' | 'enablePlugin' | 'disablePlugin'>;
  sessionManager: Pick<SessionManager, 'create' | 'clear' | 'get' | 'setActiveRole'>;
  agentEngine: Pick<AgentEngine, 'processEphemeral' | 'cancelRun'>;
  llmAdapter: LlmAdapter;
};

export function registerBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  const roleDeps: RoleCommandDeps = {
    roleManager: deps.roleManager,
    sessionManager: deps.sessionManager,
  };
  const pluginDeps: PluginCommandDeps = { extensionManager: deps.pluginManager };

  registry.register(createHelpCommand(() => registry.getAll()));
  registry.register(createBtwCommand(deps.sessionManager, deps.agentEngine, deps.roleManager));
  registry.register(createModelCommand(deps.sessionManager));
  registry.register(createClearCommand(deps.sessionManager));
  registry.register(createCompactCommand(deps.sessionManager, deps.llmAdapter, deps.roleManager));
  registry.register(createStopCommand(deps.sessionManager, deps.agentEngine));
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}
