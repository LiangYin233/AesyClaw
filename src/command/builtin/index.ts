/**
 * 内置命令的桶导出。
 *
 * `registerBuiltinCommands()` 将所有内置命令注册到
 * CommandRegistry。依赖项通过
 * BuiltinCommandDependencies 接口注入。
 *
 */

import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
import type { SessionManager } from '@aesyclaw/agent/session-manager';
import type { AgentEngine } from '@aesyclaw/agent/agent-engine';
import type { RoleManager } from '@aesyclaw/role/role-manager';
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

/**
 * 内置命令的依赖项。
 */
export type BuiltinCommandDependencies = {
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole'>;
  pluginManager: Pick<ExtensionManager, 'listPlugins' | 'enablePlugin' | 'disablePlugin'>;
  sessionManager: Pick<
    SessionManager,
    | 'clearSession'
    | 'compactSession'
    | 'getOrCreateSession'
    | 'switchRole'
    | 'getSession'
    | 'endAgentProcessing'
  >;
  agentEngine: Pick<AgentEngine, 'processEphemeral' | 'switchModel'>;
};

/**
 * 将所有内置命令注册到给定的注册表。
 *
 * @param registry - 要注册命令的 CommandRegistry
 * @param deps - 命令实现所需的依赖项
 */
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
  registry.register(createBtwCommand(deps.sessionManager, deps.agentEngine));
  registry.register(createModelCommand(deps.sessionManager, deps.agentEngine));
  registry.register(createClearCommand(deps.sessionManager));
  registry.register(createCompactCommand(deps.sessionManager));
  registry.register(createStopCommand(deps.sessionManager));
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}
