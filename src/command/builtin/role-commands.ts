/**
 * Built-in role management commands.
 *
 * Subcommands:
 *   /role list   — List all enabled roles
 *   /role switch — Switch current role (stub)
 *   /role info   — Show current role info (stub)
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

/** Dependencies needed by role commands (typed as unknown until RoleManager is implemented) */
export interface RoleCommandDeps {
  /** Will be RoleManager when implemented */
  roleManager: unknown;
}

export function createRoleListCommand(deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'role',
    description: '列出所有已启用的角色',
    usage: '/role list',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // TODO: Use deps.roleManager once RoleManager is typed
      // const roleManager = deps.roleManager as RoleManager;
      // const roles = roleManager.getEnabledRoles();
      // For now, return a stub message
      return 'Role list not yet implemented.';
    },
  };
}

export function createRoleSwitchCommand(_deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'switch',
    namespace: 'role',
    description: '切换当前角色',
    usage: '/role switch <id>',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // Stub — depends on RoleManager and session management
      return 'Role switch not yet implemented.';
    },
  };
}

export function createRoleInfoCommand(_deps: RoleCommandDeps): CommandDefinition {
  return {
    name: 'info',
    namespace: 'role',
    description: '显示当前角色信息',
    usage: '/role info',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // Stub — depends on RoleManager
      return 'Role info not yet implemented.';
    },
  };
}