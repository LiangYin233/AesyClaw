/**
 * 内置命令的桶导出。
 *
 * `registerBuiltinCommands()` 将所有内置命令注册到
 * CommandRegistry。依赖项通过
 * BuiltinCommandDependencies 接口注入。
 *
 */

import type { CommandRegistry } from '../command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
import type { SessionManager } from '../../agent/session-manager';
import type { AgentEngine } from '../../agent/agent-engine';
import type { RoleManager } from '../../role/role-manager';
import type { PluginManager } from '../../plugin/plugin-manager';
import { createHelpCommand } from './help';
import { createClearCommand } from './clear';
import { createCompactCommand } from './compact';
import { createBtwCommand } from './btw';
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
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
  sessionManager: Pick<
    SessionManager,
    'clearSession' | 'compactSession' | 'getOrCreateSession' | 'switchRole'
  >;
  agentEngine: Pick<AgentEngine, 'processEphemeral'>;
}

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
  const pluginDeps: PluginCommandDeps = { pluginManager: deps.pluginManager };

  registry.register(createHelpCommand(() => registry.getAll()));
  registry.register(
    createBtwCommand({
      sessionManager: deps.sessionManager,
      agentEngine: deps.agentEngine,
    }),
  );
  registry.register(createClearCommand({ sessionManager: deps.sessionManager }));
  registry.register(createCompactCommand({ sessionManager: deps.sessionManager }));
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}
