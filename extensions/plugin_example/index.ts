import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';

/**
 * 示例插件 — 演示插件系统的全部能力。
 *
 * 涵盖：
 * - 工具注册（registerTool）
 * - 命令注册（registerCommand）
 * - 生命周期钩子（init）
 * - 管道钩子（beforeLLM / onSend）
 * - 配置读取（defaultConfig / ctx.config）
 */
const plugin: PluginDefinition = {
  name: 'example',
  version: '0.1.0',
  description: 'Example plugin demonstrating tools, commands, and hooks.',
  defaultConfig: {
    greeting: 'Hello from plugin_example',
  },

  async init(ctx) {
    // ── 工具注册 ──
    ctx.registerTool({
      name: 'example_greet',
      description: 'Return a greeting from the example plugin.',
      parameters: Type.Object({
        name: Type.Optional(Type.String()),
      }),
      owner: 'plugin:example',
      execute: async (params) => {
        const name =
          isRecord(params) && typeof params['name'] === 'string' ? params['name'] : 'there';
        const greeting =
          typeof ctx.config['greeting'] === 'string' ? ctx.config['greeting'] : 'Hello';
        return { content: `${greeting}, ${name}!` };
      },
    });

    // ── 命令注册 ──
    ctx.registerCommand({
      name: 'example',
      description: 'Run the example plugin command.',
      usage: '/example',
      scope: 'plugin:example',
      execute: async () => 'Example plugin is active.',
    });

    ctx.logger.info('Example plugin initialized');
  },

  // ── 中间件 ──
  middlewares: [
    {
      id: 'beforeLLM-logger',
      chain: 'pipeline:beforeLLM',
      priority: 200,
      enabled: false,
      handler: async (ctx, next) => {
        return next !== undefined ? await next() : { action: 'next' };
      },
    },
    {
      id: 'onSend-footer',
      chain: 'pipeline:send',
      priority: 100,
      enabled: false,
      handler: async (ctx) => {
        return {
          action: 'respond',
          message: {
            components: [
              ...ctx.message.components,
              { type: 'Plain', text: '\n\n-- Sent via example plugin' },
            ],
          },
        };
      },
    },
  ],
};

export default plugin;
