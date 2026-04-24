/**
 * Built-in plugin management commands.
 *
 * Subcommands:
 *   /plugin list    — List loaded plugins
 *   /plugin enable  — Enable a plugin
 *   /plugin disable — Disable a plugin
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { PluginManager } from '../../plugin/plugin-manager';

export interface PluginCommandDeps {
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
}

async function resolvePluginName(
  deps: PluginCommandDeps,
  rawName: string,
): Promise<string | null> {
  const plugins = await deps.pluginManager.listPlugins();
  const plugin = plugins.find(
    (candidate) => candidate.name === rawName || candidate.directoryName === rawName,
  );

  return plugin?.name ?? null;
}

export function createPluginListCommand(deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'plugin',
    description: '列出已加载的插件',
    usage: '/plugin list',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<string> => {
      const plugins = await deps.pluginManager.listPlugins();
      if (plugins.length === 0) {
        return '当前没有发现插件。';
      }

      const lines = plugins.map((plugin) => {
        const version = plugin.version ? ` v${plugin.version}` : '';
        const error = plugin.error ? ` — 错误：${plugin.error}` : '';
        return `- ${plugin.name}${version} [${plugin.state}]${plugin.enabled ? '' : '（已禁用）'}${error}`;
      });

      return `插件列表：\n${lines.join('\n')}`;
    },
  };
}

export function createPluginEnableCommand(deps: PluginCommandDeps): CommandDefinition {
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

      const pluginName = await resolvePluginName(deps, args[0]);
      if (!pluginName) {
        return `未找到插件：${args[0]}`;
      }

      await deps.pluginManager.enable(args[0]);
      return `插件已启用：${pluginName}`;
    },
  };
}

export function createPluginDisableCommand(deps: PluginCommandDeps): CommandDefinition {
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

      const pluginName = await resolvePluginName(deps, args[0]);
      if (!pluginName) {
        return `未找到插件：${args[0]}`;
      }

      await deps.pluginManager.disable(args[0]);
      return `插件已禁用：${pluginName}`;
    },
  };
}
