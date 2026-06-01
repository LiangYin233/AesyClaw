import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { defineCommand } from '@aesyclaw/command/command-builder';
import type { Message } from '@aesyclaw/core/types';
import type { BuiltinCommandDependencies } from './types';

export function registerPluginBuiltinCommands(
  registry: CommandRegistry,
  deps: BuiltinCommandDependencies,
): void {
  registry.register(defineCommand({
    name: 'list',
    namespace: 'plugin',
    description: '列出所有插件',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (): Promise<Message> => {
      const plugins = await deps.pluginManager.listPlugins();
      if (plugins.length === 0) {
        return { components: [{ type: 'Plain', text: '没有可用的插件。' }] };
      }

      const lines = ['可用插件：\n'];
      for (const plugin of plugins) {
        const status = plugin.state === 'loaded' ? '✓' : plugin.state === 'failed' ? '✗' : '○';
        const enabled = plugin.enabled ? '启用' : '禁用';
        lines.push(`  [${status}] ${plugin.name} - ${enabled}`);
      }

      return { components: [{ type: 'Plain', text: lines.join('\n') }] };
    },
  }));

  registry.register(defineCommand({
    name: 'enable',
    namespace: 'plugin',
    description: '启用指定插件',
    usage: '/plugin:enable <plugin-name>',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[]): Promise<Message> => {
      const pluginName = args.join(' ').trim();
      if (pluginName.length === 0) {
        return { components: [{ type: 'Plain', text: '用法：/plugin:enable <plugin-name>' }] };
      }

      try {
        await deps.pluginManager.enable(pluginName);
        return { components: [{ type: 'Plain', text: `插件 ${pluginName} 已启用。` }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `启用插件失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  }));

  registry.register(defineCommand({
    name: 'disable',
    namespace: 'plugin',
    description: '禁用指定插件',
    usage: '/plugin:disable <plugin-name>',
    scope: 'system',
    allowDuringAgentProcessing: true,
    execute: async (args: string[]): Promise<Message> => {
      const pluginName = args.join(' ').trim();
      if (pluginName.length === 0) {
        return { components: [{ type: 'Plain', text: '用法：/plugin:disable <plugin-name>' }] };
      }

      try {
        await deps.pluginManager.disable(pluginName);
        return { components: [{ type: 'Plain', text: `插件 ${pluginName} 已禁用。` }] };
      } catch (err) {
        return {
          components: [
            {
              type: 'Plain',
              text: `禁用插件失败：${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  }));
}
