import { join } from 'path';
import { EventBus } from '../bus/EventBus.js';
import { AgentLoop } from '../agent/AgentLoop.js';
import { ChannelManager, OneBotChannel } from '../channels/index.js';
import { createProvider } from '../providers/index.js';
import { ToolRegistry } from '../tools/index.js';
import { SessionManager } from '../session/index.js';
import { MCPClientManager } from '../mcp/index.js';
import { PluginManager } from '../plugins/index.js';
import { APIServer } from '../api/index.js';
import { CronService } from '../cron/index.js';
import { registerCronTools } from '../cron/CronTools.js';
import { logger } from '../logger/index.js';
import type { Config } from '../types.js';
import type { LLMProvider } from '../providers/base.js';
import type { AgentLoop as AgentLoopType } from '../agent/AgentLoop.js';
import type { CronJob } from '../cron/index.js';
import type { PluginManager as PluginManagerType } from '../plugins/index.js';
import type { SessionManager as SessionManagerType } from '../session/index.js';
import type { ChannelManager as ChannelManagerType } from '../channels/index.js';
import type { ToolRegistry as ToolRegistryType } from '../tools/index.js';
import type { APIServer as APIServerType } from '../api/server.js';

export interface Services {
  eventBus: EventBus;
  provider: LLMProvider;
  toolRegistry: ToolRegistryType;
  sessionManager: SessionManagerType;
  channelManager: ChannelManagerType;
  pluginManager: PluginManagerType;
  agent: AgentLoopType;
  cronService: CronService;
  mcpManager: MCPClientManager | null;
  config: Config;
  workspace: string;
  apiServer: APIServerType;
}

export interface ServiceFactoryOptions {
  workspace: string;
  config: Config;
  port: number;
  onCronJob?: (job: CronJob) => Promise<void>;
}

export function parseTarget(to: string): { chatId: string; messageType: 'private' | 'group' } | null {
  const match = to.match(/^(private|group):(.+)$/);
  if (!match) return null;
  return {
    chatId: match[2],
    messageType: match[1] as 'private' | 'group'
  };
}

export class ServiceFactory {
  private log = logger.child({ prefix: 'ServiceFactory' });

  async create(options: ServiceFactoryOptions): Promise<Services> {
    const { workspace, config, port, onCronJob } = options;

    logger.setLevel(config.log?.level || 'info');
    const log = logger.child({ prefix: 'AesyClaw' });

    log.info('Initializing services...');

    const eventBus = new EventBus();
    log.debug('EventBus created');

    const providerConfig = config.providers[config.agent.defaults.provider];
    const provider = createProvider(config.agent.defaults.provider, providerConfig);
    log.debug('Provider created');

    const toolRegistry = new ToolRegistry();
    log.debug('ToolRegistry created');

    const sessionManager = new SessionManager(
      join(workspace, '.aesyclaw', 'sessions'),
      config.agent.defaults.maxSessions || 100
    );
    await sessionManager.ready();
    await sessionManager.loadAll();
    log.info(`SessionManager ready, ${sessionManager.count()} sessions loaded`);

    const pluginManager = new PluginManager(
      {
        config,
        eventBus,
        agent: null as AgentLoopType | null,
        workspace,
        registerTool: (tool) => toolRegistry.register(tool as any),
        getToolRegistry: () => toolRegistry as any,
        logger,
        sendMessage: async (channel, chatId, content, messageType) => {
          await eventBus.publishOutbound({ channel, chatId, content, messageType: messageType || 'private' });
        }
      },
      toolRegistry as any
    );

    if (config.plugins) {
      pluginManager.setPluginConfigs(config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>);
    }

    const newPluginConfigs = await pluginManager.applyDefaultConfigs();
    if (Object.keys(newPluginConfigs).length > 0) {
      config.plugins = newPluginConfigs;
      const { ConfigLoader } = await import('../config/loader.js');
      await ConfigLoader.save(config);
      log.info('Applied default plugin configs');
    }

    if (config.plugins && Object.keys(config.plugins).length > 0) {
      await pluginManager.loadFromConfig(config.plugins);
    }

    const cronService = new CronService(
      join(workspace, '.aesyclaw', 'cron-jobs.json'),
      onCronJob || (async () => {})
    );
    await cronService.start();
    log.debug('CronService started');

    const channelManager = new ChannelManager(eventBus);
    log.debug('ChannelManager created');

    if (config.channels.onebot?.enabled) {
      const oneBotChannel = new OneBotChannel(config.channels.onebot, eventBus);
      channelManager.register(oneBotChannel);
    }

    const agent = new AgentLoop(
      eventBus,
      provider,
      toolRegistry,
      sessionManager,
      workspace,
      config.agent.defaults.systemPrompt,
      config.agent.defaults.maxToolIterations,
      config.agent.defaults.model,
      config.agent.defaults.contextMode,
      config.agent.defaults.memoryWindow
    );

    pluginManager.context.agent = agent;
    pluginManager.updateAgent(agent);
    agent.setPluginManager(pluginManager);

    let mcpManager: MCPClientManager | null = null;
    if (config.mcp && Object.keys(config.mcp).length > 0) {
      mcpManager = new MCPClientManager();
      await mcpManager.connect(config.mcp);

      const mcpTools = mcpManager.getTools();
      for (const tool of mcpTools) {
        toolRegistry.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (params) => {
            return mcpManager!.callTool(tool.name, params);
          }
        });
      }
      log.info(`MCP tools loaded: ${mcpTools.length}`);
    }

    registerCronTools(toolRegistry, cronService, eventBus);

    const apiServer = new APIServer(
      port,
      agent,
      sessionManager,
      channelManager,
      config,
      pluginManager,
      cronService
    );
    await apiServer.start();
    log.info(`API server started on port ${port}`);

    return {
      eventBus,
      provider,
      toolRegistry,
      sessionManager,
      channelManager,
      pluginManager,
      agent,
      cronService,
      mcpManager,
      config,
      workspace,
      apiServer
    };
  }
}
