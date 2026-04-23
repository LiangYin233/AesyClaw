/**
 * Barrel export for built-in commands.
 *
 * `registerBuiltinCommands()` registers all built-in commands with
 * the CommandRegistry. Dependencies are injected through the
 * BuiltinCommandDependencies interface.
 *
 * @see project.md §5.9
 */

import type { CommandContext } from '../../core/types';
import type { CommandRegistry } from '../command-registry';
import type { RoleCommandDeps } from './role-commands';
import type { PluginCommandDeps } from './plugin-commands';
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
 * Most are typed as `unknown` because the subsystems (RoleManager,
 * PluginManager, SessionManager) are not yet implemented.
 */
export interface BuiltinCommandDependencies {
  /** Will be RoleManager when implemented */
  roleManager: unknown;
  /** Will be PluginManager when implemented */
  pluginManager: unknown;
  /** Will be SessionManager when implemented */
  sessionManager: unknown;
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
  const roleDeps: RoleCommandDeps = { roleManager: deps.roleManager };
  const pluginDeps: PluginCommandDeps = { pluginManager: deps.pluginManager };

  registry.register(createHelpCommand(() => registry.getAll()));
  registry.register(createClearCommand());
  registry.register(createCompactCommand());
  registry.register(createRoleListCommand(roleDeps));
  registry.register(createRoleSwitchCommand(roleDeps));
  registry.register(createRoleInfoCommand(roleDeps));
  registry.register(createPluginListCommand(pluginDeps));
  registry.register(createPluginEnableCommand(pluginDeps));
  registry.register(createPluginDisableCommand(pluginDeps));
}