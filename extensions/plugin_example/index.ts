import { Type } from '@sinclair/typebox';
import type { PluginDefinition } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';

const plugin: PluginDefinition = {
  name: 'example',
  version: '0.1.0',
  description: 'Example plugin demonstrating tools, commands, and hooks.',
  defaultConfig: {
    greeting: 'Hello from plugin_example',
  },
  async init(ctx) {
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

    ctx.registerCommand({
      name: 'example',
      description: 'Run the example plugin command.',
      usage: '/example',
      scope: 'plugin:example',
      execute: async () => 'Example plugin is active.',
    });

    ctx.logger.info('Example plugin initialized');
  },
  async destroy() {
    // No external resources to release in the example plugin.
  },
  hooks: {
    async onReceive() {
      return { action: 'continue' };
    },
  },
};

export default plugin;
