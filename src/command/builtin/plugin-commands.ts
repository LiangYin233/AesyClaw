/**
 * 内置插件管理命令。
 *
 * 子命令：
 *   /plugin list    — 列出已加载的插件
 *   /plugin enable  — 启用插件
 *   /plugin disable — 禁用插件
 *
 */

import type { CommandDefinition, CommandContext, Message } from '@aesyclaw/core/types';
import type { PluginManager } from '@aesyclaw/extension/plugin/manager';

export type PluginCommandDeps = {
  pluginManager: Pick<PluginManager, 'listPlugins' | 'enable' | 'disable'>;
};

async function resolvePluginName(deps: PluginCommandDeps, rawName: string): Promise<string | null> {
  const plugins = await deps.pluginManager.listPlugins();
  const plugin = plugins.find(
    (candidate) => candidate.name === rawName || candidate.directoryName === rawName,
  );

  return plugin?.name ?? null;
}

/**
 * 创建 plugin list 命令定义。
 *
 * @param deps - 包含 pluginManager 的依赖项
 * @returns plugin list 命令的 CommandDefinition
 */
export function createPluginListCommand(deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'list',
    namespace: 'plugin',
    description: '列出已加载的插件',
    usage: '/plugin list',
    scope: 'system',
    execute: async (_args: string[], _context: CommandContext): Promise<Message> => {
      const plugins = await deps.pluginManager.listPlugins();
      if (plugins.length === 0) {
        return { components: [{ type: 'Plain', text: '当前没有发现插件。' }] };
      }

      const lines = plugins.map((plugin) => {
        const version = plugin.version ? ` v${plugin.version}` : '';
        const error = plugin.error ? ` — 错误：${plugin.error}` : '';
        return `- ${plugin.name}${version} [${plugin.state}]${plugin.enabled ? '' : '（已禁用）'}${error}`;
      });

      return { components: [{ type: 'Plain', text: '插件列表：\n' + lines.join('\n') }] };
    },
  };
}

/**
 * 创建 plugin enable 命令定义。
 *
 * @param deps - 包含 pluginManager 的依赖项
 * @returns plugin enable 命令的 CommandDefinition
 */
export function createPluginEnableCommand(deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'enable',
    namespace: 'plugin',
    description: '启用指定插件',
    usage: '/plugin enable <name>',
    scope: 'system',
    execute: async (args: string[], _context: CommandContext): Promise<Message> => {
      if (args.length === 0) {
        return { components: [{ type: 'Plain', text: '用法：/plugin enable <name>' }] };
      }

      const name = args[0];
      if (!name) {
        return { components: [{ type: 'Plain', text: '用法：/plugin enable <name>' }] };
      }

      const pluginName = await resolvePluginName(deps, name);
      if (!pluginName) {
        return { components: [{ type: 'Plain', text: `未找到插件：${name}` }] };
      }

      await deps.pluginManager.enable(pluginName);
      return { components: [{ type: 'Plain', text: `插件已启用：${pluginName}` }] };
    },
  };
}

/**
 * 创建 plugin disable 命令定义。
 *
 * @param deps - 包含 pluginManager 的依赖项
 * @returns plugin disable 命令的 CommandDefinition
 */
export function createPluginDisableCommand(deps: PluginCommandDeps): CommandDefinition {
  return {
    name: 'disable',
    namespace: 'plugin',
    description: '禁用指定插件',
    usage: '/plugin disable <name>',
    scope: 'system',
    execute: async (args: string[], _context: CommandContext): Promise<Message> => {
      if (args.length === 0) {
        return { components: [{ type: 'Plain', text: '用法：/plugin disable <name>' }] };
      }

      const name = args[0];
      if (!name) {
        return { components: [{ type: 'Plain', text: '用法：/plugin disable <name>' }] };
      }

      const pluginName = await resolvePluginName(deps, name);
      if (!pluginName) {
        return { components: [{ type: 'Plain', text: `未找到插件：${name}` }] };
      }

      await deps.pluginManager.disable(pluginName);
      return { components: [{ type: 'Plain', text: `插件已禁用：${pluginName}` }] };
    },
  };
}
