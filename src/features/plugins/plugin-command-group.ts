import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import { logger } from '@/platform/observability/logger.js';
import { createMissingArgumentResult, createUnknownSubcommandResult } from '@/platform/commands/subcommand-utils.js';

export interface PluginCommandGroupDeps {
  getPluginCommands: () => CommandDefinition[];
  enablePlugin: (_pluginName: string) => Promise<{ success: boolean; message: string }>;
  disablePlugin: (_pluginName: string) => Promise<{ success: boolean; message: string }>;
}

const PLUGIN_SUBCOMMANDS = [
  '  /plugin list     - 列出所有插件',
  '  /plugin enable   - 开启插件',
  '  /plugin disable  - 关闭插件',
];

function formatPluginList(getPluginCommands: () => CommandDefinition[]): string {
  const plugins = getPluginCommands();

  if (plugins.length === 0) {
    return '暂无已加载的插件命令。';
  }

  let output = '插件状态：\n\n';
  const pluginMap = new Map<string, { loaded: boolean; commands: string[] }>();

  for (const cmd of plugins) {
    const parts = cmd.name.split(':');
    const pluginName = parts[0];
    if (!pluginMap.has(pluginName)) {
      pluginMap.set(pluginName, { loaded: true, commands: [] });
    }
    pluginMap.get(pluginName)!.commands.push(
      `  /${cmd.name} - ${cmd.description}`
    );
  }

  for (const [pluginName, info] of pluginMap) {
    const status = info.loaded ? '[已加载]' : '[未加载]';
    output += `${status} ${pluginName}\n`;
    output += info.commands.join('\n');
    output += '\n\n';
  }

  return output.trim();
}

export function createPluginCommandGroup(deps: PluginCommandGroupDeps): CommandDefinition[] {
  return [
    {
      name: 'plugin',
      description: '插件管理命令',
      usage: '/plugin <list|enable|disable> [args...]',
      category: 'system',
      aliases: ['plugins'],
      execute: async (ctx: CommandContext): Promise<CommandResult> => {
        const subCommand = ctx.args[0]?.toLowerCase();

        switch (subCommand) {
          case 'list': {
            return {
              success: true,
              message: formatPluginList(deps.getPluginCommands),
            };
          }

          case 'enable': {
            const pluginName = ctx.args[1];
            if (!pluginName) {
              return createMissingArgumentResult('请指定要开启的插件名称', '/plugin enable <plugin-name>');
            }

            logger.info({ pluginName }, '正在开启插件');
            return deps.enablePlugin(pluginName);
          }

          case 'disable': {
            const pluginName = ctx.args[1];
            if (!pluginName) {
              return createMissingArgumentResult('请指定要关闭的插件名称', '/plugin disable <plugin-name>');
            }

            logger.info({ pluginName }, '正在关闭插件');
            return deps.disablePlugin(pluginName);
          }

          default: {
            return createUnknownSubcommandResult(subCommand, PLUGIN_SUBCOMMANDS);
          }
        }
      },
    },
  ];
}
