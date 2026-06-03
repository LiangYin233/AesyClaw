import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';

/**
 * 示例插件 — 演示新插件 API 的基础能力。
 */
const plugin: PluginDefinition = {
  name: 'example',
  version: '0.1.0',
  description: 'Example plugin demonstrating tools, commands, and hooks.',
  configSchema: Type.Object({
    greeting: Type.String({ default: 'Hello from plugin_example' }),
  }),

  async init(ctx) {
    ctx.registry.tools.register({
      name: 'example_greet',
      description: 'Return a greeting from the example plugin.',
      parameters: Type.Object({
        name: Type.Optional(Type.String()),
      }),
      execute: async (params: unknown) => {
        const name =
          isRecord(params) && typeof params['name'] === 'string' ? params['name'] : 'there';
        const greeting = ctx.config.self.get<string>('greeting') ?? 'Hello';
        return { content: `${greeting}, ${name}!` };
      },
    });

    ctx.registry.commands.register({
      name: 'example',
      description: 'Run the example plugin command.',
      usage: '/example',
      execute: async () => ({ components: [{ type: 'Plain', text: 'Example plugin is active.' }] }),
    });

    ctx.hooks.register({
      id: 'beforeAgent-logger',
      chain: 'pipeline:beforeAgent',
      priority: 200,
      handler: async (_ctx, next) => {
        return next !== undefined ? await next() : { action: 'next' };
      },
    });

    ctx.hooks.register({
      id: 'onSend-footer',
      chain: 'pipeline:send',
      priority: 100,
      handler: async (hookCtx) => {
        return {
          action: 'respond',
          message: {
            components: [
              ...hookCtx.message.components,
              { type: 'Plain', text: '\n\n-- Sent via example plugin' },
            ],
          },
        };
      },
    });

    ctx.log.info('Example plugin initialized');
  },
};

export default plugin;
