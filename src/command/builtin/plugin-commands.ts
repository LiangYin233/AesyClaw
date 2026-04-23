/**
 * Built-in plugin management commands.
 *
 * Subcommands:
 *   /plugin list    — List loaded plugins
 *   /plugin enable  — Enable a plugin (stub)
 *   /plugin disable — Disable a plugin (stub)
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';

/** Dependencies needed by plugin commands (typed as unknown until PluginManager is implemented) */
export interface PluginCommandDeps {
  /** Will be PluginManager when implemented */
  pluginManager: unknown;
}

export function createPluginListCommand(deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'plugin',
    description: '列出已加载的插件',
    usage: '/plugin list',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      // TODO: Use deps.pluginManager once PluginManager is typed
      return 'Plugin list not yet implemented.';
    },
  };
}

export function createPluginEnableCommand(_deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'enable',
    namespace: 'plugin',
    description: '启用指定插件',
    usage: '/plugin enable <name>',
    scope: 'system',
    execute: async (args: string[], _context: CommandContext): Promise<string> => {
      if (args.length === 0) {
        return 'Usage: /plugin enable <name>';
      }
      // Stub — depends on PluginManager
      return `Plugin enable not yet implemented (target: ${args[0]}).`;
    },
  };
}

export function createPluginDisableCommand(_deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'disable',
    namespace: 'plugin',
    description: '禁用指定插件',
    usage: '/plugin disable <name>',
    scope: 'system',
    execute: async (args: string[], _context: CommandContext): Promise<string> => {
      if (args.length === 0) {
        return 'Usage: /plugin disable <name>';
      }
      // Stub — depends on PluginManager
      return `Plugin disable not yet implemented (target: ${args[0]}).`;
    },
  };
}