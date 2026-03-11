import type { Config, OutboundMessage } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import type { AgentLoop } from '../../agent/index.js';
import type { Tool, ToolRegistry } from '../../tools/ToolRegistry.js';
import { PluginManager } from '../../plugins/index.js';
import type { PluginContext } from '../../plugins/PluginManager.js';
import { ConfigLoader } from '../../config/loader.js';
import { logger } from '../../logger/index.js';

const log = logger.child({ prefix: 'PluginRuntimeFactory' });

export async function createPluginManager(args: {
  config: Config;
  eventBus: EventBus;
  agent: AgentLoop;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}): Promise<PluginManager> {
  const { config, eventBus, agent, workspace, tempDir, toolRegistry } = args;
  let pluginManager!: PluginManager;

  const pluginContext: PluginContext = {
    config,
    eventBus,
    agent,
    workspace,
    tempDir,
    registerTool: (tool: Tool) => toolRegistry.register(tool),
    getToolRegistry: () => toolRegistry,
    logger,
    sendMessage: async (
      channel: string,
      chatId: string,
      content: string,
      messageType?: 'private' | 'group'
    ) => {
      let message: OutboundMessage = {
        channel,
        chatId,
        content,
        messageType: messageType || 'private'
      };

      message = await pluginManager.applyOnResponse(message) || message;
      await eventBus.publishOutbound(message);
    }
  };

  pluginManager = new PluginManager(pluginContext, toolRegistry);

  if (config.plugins) {
    pluginManager.setPluginConfigs(config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
  }

  const newPluginConfigs = await pluginManager.applyDefaultConfigs();
  if (Object.keys(newPluginConfigs).length > 0) {
    config.plugins = newPluginConfigs;
    await ConfigLoader.save(config);
    log.info('Applied default plugin configs');
  }

  if (config.plugins && Object.keys(config.plugins).length > 0) {
    await pluginManager.loadFromConfig(config.plugins);
  }

  return pluginManager;
}
