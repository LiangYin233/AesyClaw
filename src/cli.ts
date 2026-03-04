import { Command } from 'commander';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ConfigLoader } from './config/loader.js';
import { EventBus } from './bus/EventBus.js';
import { AgentLoop } from './agent/AgentLoop.js';
import { ChannelManager, OneBotChannel } from './channels/index.js';
import { createProvider } from './providers/index.js';
import { ToolRegistry } from './tools/index.js';
import { SessionManager } from './session/index.js';
import { MCPClientManager } from './mcp/index.js';
import { PluginManager } from './plugins/index.js';
import { APIServer } from './api/index.js';
import { CronService, type CronJob, type CronSchedule, parseTarget } from './cron/index.js';
import { createLogger, logger } from './logger/index.js';
import { CONSTANTS } from './constants/index.js';
import type { Config, OutboundMessage, InboundMessage } from './types.js';

const program = new Command();

function parseInterval(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  
  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

program
  .name('aesyclaw')
  .description('A lightweight AI agent framework')
  .version('0.1.0');

program
  .command('gateway')
  .option('-p, --port <port>', 'API Port', '18792')
  .action(async (options) => {
    let config = await ConfigLoader.load() as Config;
    const workspace = process.cwd();
    
    logger.setLevel(config.log?.level || 'info');
    
    const log = logger.child({ prefix: 'AesyClaw' });
    
    log.info('Starting gateway...');
    log.info(`Workspace: ${workspace}`);
    log.info(`Config loaded, provider: ${config.agent.defaults.provider}, model: ${config.agent.defaults.model}`);
    
    const eventBus = new EventBus();
    log.info('EventBus initialized');
    
    const providerConfig = config.providers[config.agent.defaults.provider];
    log.debug(`Provider config:`, providerConfig);
    const provider = createProvider(config.agent.defaults.provider, providerConfig);
    log.info('Provider created');
    
    const toolRegistry = new ToolRegistry();
    log.info('ToolRegistry initialized (tools provided by plugins)');
    
    const sessionManager = new SessionManager(
      join(workspace, '.aesyclaw', 'sessions'),
      config.agent.defaults.maxSessions || 100
    );
    log.info('Loading sessions...');
    await sessionManager.ready();
    await sessionManager.loadAll();
    log.info(`Sessions loaded: ${sessionManager.count()}`);
    
    const pluginManager = new PluginManager(
      {
        config,
        eventBus,
        agent: null as AgentLoop | null,
        workspace,
        registerTool: (tool) => toolRegistry.register(tool),
        getToolRegistry: () => toolRegistry,
        logger,
        sendMessage: async (channel, chatId, content, messageType) => {
          await eventBus.publishOutbound({ channel, chatId, content, messageType: messageType || 'private' });
        }
      },
      toolRegistry
    );

    if (config.plugins) {
      const pluginConfigs = config.plugins as Record<string, { enabled: boolean; options?: Record<string, any> }>;
      pluginManager.setPluginConfigs(pluginConfigs);
    }

    const newPluginConfigs = await pluginManager.applyDefaultConfigs();
    
    if (Object.keys(newPluginConfigs).length > 0) {
      config.plugins = newPluginConfigs;
      await ConfigLoader.save(config);
      log.info('Applied default plugin configs to config.yaml');
    }

    if (config.plugins && Object.keys(config.plugins).length > 0) {
      log.info('Loading plugins from config...');
      await pluginManager.loadFromConfig(config.plugins);
    }

    const cronService = new CronService(
      join(workspace, '.aesyclaw', 'cron-jobs.json'),
      async (job: CronJob) => {
        log.info(`Cron job triggered: ${job.name}`);
        
        const tempAgent = new AgentLoop(
          eventBus,
          provider,
          toolRegistry,
          sessionManager,
          workspace,
          config.agent.defaults.systemPrompt,
          config.agent.defaults.maxToolIterations,
          config.agent.defaults.model,
          'global',
          0
        );
        
        const sessionKey = `cron:${job.id}:${randomUUID().slice(0, 8)}`;
        log.info(`Creating temporary agent loop for cron job, session: ${sessionKey}`);
        
        try {
          const response = await tempAgent.processDirect(job.payload.detail, sessionKey);
          
          const targetChannel = job.payload.channel || 'onebot';
          const target = job.payload.target;
          
          if (target) {
            const parsed = parseTarget(target);
            if (!parsed) {
              log.error(`Invalid target format: ${target}, expected private:QQ号 或 group:群号`);
              return;
            }
            
            let outboundMsg: OutboundMessage = {
              channel: targetChannel,
              chatId: parsed.chatId,
              content: response,
              messageType: parsed.messageType
            };
            
            if (pluginManager) {
              outboundMsg = await pluginManager.applyOnResponse(outboundMsg) || outboundMsg;
            }
            
            await eventBus.publishOutbound(outboundMsg);
            log.info(`Cron job response sent to ${target}:${parsed.messageType}`);
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Cron job execution failed:`, message);
        }
      }
    );
    await cronService.start();
    log.info('CronService started');
    
    const channelManager = new ChannelManager(eventBus);
    log.info('ChannelManager initialized');
    
    if (config.channels.onebot?.enabled) {
      log.info('OneBot channel enabled, creating...');
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
    agent.setPluginManager(pluginManager);
    
    if (config.mcp && Object.keys(config.mcp).length > 0) {
      log.info('MCP servers configured, connecting...');
      const mcpManager = new MCPClientManager();
      await mcpManager.connect(config.mcp);
      
      const mcpTools = mcpManager.getTools();
      log.info(`MCP tools loaded: ${mcpTools.length}`);
      
      for (const tool of mcpTools) {
        toolRegistry.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (params) => {
            return mcpManager.callTool(tool.name, params);
          }
        });
        log.debug(`Registered MCP tool: ${tool.name}`);
      }
    } else {
      log.info('No MCP servers configured');
    }
    
    toolRegistry.register({
      name: 'create_cron_task',
      description: '创建一个定时任务',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['once', 'interval', 'daily'],
            description: '运行类型：once-指定时间执行一次, interval-间隔执行, daily-每日指定时间执行'
          },
          time: {
            type: 'string',
            description: '运行时间 (once: ISO时间如 "2024-01-01T10:00:00Z", interval: 间隔如 "10m"/"1h", daily: 每日时间如 "09:00")'
          },
          description: {
            type: 'string',
            description: '任务简介'
          },
          detail: {
            type: 'string',
            description: '任务详细描述，触发时将发送给LLM处理'
          },
          target: {
            type: 'string',
            description: '发送目标，格式：private:QQ号 或 group:群号，如 private:163213819 或 group:381297421'
          }
        },
        required: ['type', 'time', 'description', 'detail']
      },
      execute: async (params: Record<string, any>) => {
        const { type, time, description, detail, target } = params;
        
        const schedule: CronSchedule = { kind: type };
        
        switch (type) {
          case 'once':
            schedule.onceAt = time;
            break;
          case 'interval':
            const intervalMs = parseInterval(time);
            if (!intervalMs) {
              return JSON.stringify({ success: false, error: '无效的间隔格式，请使用如 "10m", "1h", "30s"' });
            }
            schedule.intervalMs = intervalMs;
            break;
          case 'daily':
            schedule.dailyAt = time;
            break;
        }
        
        const job: CronJob = {
          id: randomUUID().slice(0, 8),
          name: description,
          enabled: true,
          schedule,
          payload: {
            description,
            detail,
            target
          }
        };
        
        cronService.addJob(job);
        
        return JSON.stringify({ success: true, id: job.id, message: `任务已创建: ${description}` });
      }
    });
    
    toolRegistry.register({
      name: 'delete_cron_task',
      description: '删除定时任务',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: '任务ID'
          }
        },
        required: ['id']
      },
      execute: async (params: Record<string, any>) => {
        const { id } = params;
        const removed = cronService.removeJob(id);
        
        if (removed) {
          return JSON.stringify({ success: true, message: `任务 ${id} 已删除` });
        } else {
          return JSON.stringify({ success: false, error: `任务 ${id} 不存在` });
        }
      }
    });
    
    toolRegistry.register({
      name: 'list_cron_task',
      description: '列出所有定时任务',
      parameters: {
        type: 'object',
        properties: {}
      },
      execute: async () => {
        const jobs = cronService.listJobs();
        
        return JSON.stringify({
          success: true,
          jobs: jobs.map(job => ({
            id: job.id,
            name: job.name,
            enabled: job.enabled,
            kind: job.schedule.kind,
            nextRunAtMs: job.nextRunAtMs,
            lastRunAtMs: job.lastRunAtMs
          }))
        });
      }
    });
    
    toolRegistry.register({
      name: 'send_msg_to_user',
      description: '发送消息给用户或群（仅 Agent 模式可用）',
      agentOnly: true,
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: '要发送的消息内容'
          },
          to: {
            type: 'string',
            description: '发送目标，格式：private:QQ号 或 group:群号，如 private:163213819 或 group:381297421'
          }
        },
        required: ['message', 'to']
      },
      execute: async (params: Record<string, any>) => {
        const { message, to } = params;
        
        const parsed = parseTarget(to);
        if (!parsed) {
          return JSON.stringify({ success: false, error: '无效的目标格式，请使用 private:QQ号 或 group:群号' });
        }
        
        await eventBus.publishOutbound({
          channel: 'onebot',
          chatId: parsed.chatId,
          content: message,
          messageType: parsed.messageType
        });
        
        log.info(`send_msg_to_user: message sent to ${to}`);
        
        return JSON.stringify({ success: true, message: `消息已发送到 ${to}` });
      }
    });
    
    log.info('Cron tools registered');
    
    log.info('Starting channels...');
    try {
      await Promise.race([
        channelManager.startAll(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Channel start timeout after ${CONSTANTS.CHANNEL_START_TIMEOUT / 1000}s`)), CONSTANTS.CHANNEL_START_TIMEOUT)
        )
      ]);
    } catch (error) {
      log.error('Failed to start channels:', error);
    }
    log.info('Channels started');
    
    eventBus.on('outbound', async (msg: OutboundMessage) => {
      log.debug(`Outbound message to ${msg.channel}:${msg.chatId}`);
      const channel = channelManager.get(msg.channel);
      if (channel) {
        try {
          await channel.send(msg);
          log.debug(`Message sent via ${msg.channel}`);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          log.error(`Failed to send message: ${message}`);
        }
      } else {
        log.warn(`Channel ${msg.channel} not found`);
      }
    });
    
    log.info('Starting API server...');
    const apiServer = new APIServer(
      parseInt(options.port),
      agent,
      sessionManager,
      channelManager,
      config,
      pluginManager,
      cronService
    );
    await apiServer.start();
    
    ConfigLoader.onReload(async (newConfig) => {
      log.info('Handling config reload...');
      
      if (newConfig.agent.defaults.provider !== config.agent.defaults.provider ||
          newConfig.providers[newConfig.agent.defaults.provider]?.apiBase !== config.providers[config.agent.defaults.provider]?.apiBase ||
          newConfig.agent.defaults.model !== config.agent.defaults.model) {
        log.info('Provider/model changed, updating...');
        log.debug(`Old: ${config.agent.defaults.provider}/${config.agent.defaults.model}`);
        log.debug(`New: ${newConfig.agent.defaults.provider}/${newConfig.agent.defaults.model}`);
        const newProviderConfig = newConfig.providers[newConfig.agent.defaults.provider];
        const newProvider = createProvider(newConfig.agent.defaults.provider, newProviderConfig);
        agent.updateProvider(newProvider, newConfig.agent.defaults.model);
      }
      
      config = newConfig;
      apiServer.updateConfig(config);
      
      log.info('Config reload completed');
    });
    
    log.info('Config hot reload enabled');
    
    const runAgent = async () => {
      try {
        await agent.run();
      } catch (err: any) {
        logger.error(`Agent error: ${err.message}`);
        log.error(`Agent crashed: ${err.message}`);
        process.exit(1);
      }
    };
    runAgent();
    
    process.on('SIGINT', async () => {
      log.info('Shutting down...');
      agent.stop();
      await channelManager.stopAll();
      await apiServer.stop();
      await sessionManager.close();
      ConfigLoader.stopWatching();
      process.exit(0);
    });
  });

program.parse();
