/**
 * Barrel export for built-in commands.
 *
 * `registerBuiltinCommands()` registers all built-in commands with
 * the CommandRegistry. Dependencies are injected through the
 * BuiltinCommandDependencies interface.
 *
 */

import type { CommandRegistry } from '../command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
import type { SessionManager } from '../../agent/session-manager';
import type { RoleManager } from '../../role/role-manager';
import type { PluginManager } from '../../plugin/plugin-manager';
import { createHelpCommand } from './help';
import { createClearCommand } from './clear';
import { createCompactCommand } from './compact';
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
 * Dependencies for built-in commands.
 *
 * Dependencies for built-in commands.
 */
export interface BuiltinCommandDependencies {
  roleManager: Pick<RoleManager, 'getEnabledRoles' | 'getRole'>;
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
  sessionManager: Pick<
    SessionManager,
    'clearSession' | 'compactSession' | 'getOrCreateSession' | 'switchRole'
  >;
}

/**
 * Register all built-in commands with the given registry.
 *
 * @param registry - The CommandRegistry to register commands into
 * @param deps - Dependencies required by the command implementations
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
  registry.register(createClearCommand({ sessionManager: deps.sessionManager }));
  registry.register(createCompactCommand({ sessionManager: deps.sessionManager }));
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}
