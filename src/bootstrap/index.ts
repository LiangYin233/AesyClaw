import { randomUUID } from 'crypto';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { ConfigLoader } from '../config/loader.js';
import { createServices, type Services } from './ServiceFactory.js';
import { logger, normalizeError } from '../logger/index.js';
import { parseTarget } from './utils.js';
import { createProvider } from '../providers/index.js';
import { CONSTANTS } from '../constants/index.js';
import type { Config, OutboundMessage } from '../types.js';
import type { CronJob } from '../cron/index.js';

const log = logger.child({ prefix: 'Bootstrap' });

export async function bootstrap(port: number): Promise<void> {
  const config = await ConfigLoader.load() as Config;
  const workspace = join(process.cwd(), 'workspace');

  // Ensure workspace directory exists
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  log.info('Starting AesyClaw...');
  log.info(`Workspace: ${workspace}`);
  log.info(`Provider: ${config.agent.defaults.provider}, Model: ${config.agent.defaults.model}`);

  const services = await createServices({
    workspace,
    config,
    port,
    onCronJob: async (job: CronJob) => {
      log.info(`Cron job triggered: ${job.name}`);

      const { provider, toolRegistry, sessionManager, config: cronConfig, pluginManager, eventBus } = services;
      const { AgentExecutor } = await import('../agent/AgentExecutor.js');

      const executor = new AgentExecutor(
        provider, toolRegistry, workspace,
        cronConfig.agent.defaults.systemPrompt,
        undefined,
        cronConfig.agent.defaults.model,
        cronConfig.agent.defaults.maxToolIterations,
        pluginManager
      );

      const sessionKey = `cron:${job.id}:${randomUUID().slice(0, 8)}`;
      const target = job.payload.target;

      try {
        let toolContext: import('../tools/ToolRegistry.js').ToolContext = { workspace, eventBus };

        if (target) {
          const parsed = parseTarget(target);
          if (parsed) {
            toolContext = {
              ...toolContext,
              channel: parsed.channel,
              chatId: parsed.chatId,
              messageType: parsed.messageType,
              source: 'cron' as const
            };
          } else {
            log.error(`Invalid target format: ${target}`);
          }
        }

        const session = await sessionManager.getOrCreate(sessionKey);
        const messages = executor.buildContext(session.messages, job.payload.detail);
        const result = await executor.execute(messages, toolContext, { allowTools: true, source: 'cron' });

        await sessionManager.addMessage(sessionKey, 'user', job.payload.detail);
        await sessionManager.addMessage(sessionKey, 'assistant', result.content);

        if (target && toolContext.chatId) {
          let outboundMsg: OutboundMessage = {
            channel: toolContext.channel!,
            chatId: toolContext.chatId,
            content: result.content,
            messageType: toolContext.messageType!
          };

          if (pluginManager) {
            outboundMsg = await pluginManager.applyOnResponse(outboundMsg) || outboundMsg;
          }

          await eventBus.publishOutbound(outboundMsg);
          log.info(`Cron job response sent to ${target}`);
        }
      } catch (error: unknown) {
        log.error(`Cron job failed: ${normalizeError(error)}`);
      }
    }
  });

  // Wire outbound handler
  wireOutbound(services);

  // Setup config hot-reload
  setupConfigReload(services);

  // Start channels
  await startChannels(services);

  // Setup signal handlers
  setupSignalHandlers(services);

  // Run agent loop
  services.agent.run().catch((err: Error) => {
    log.error(`Agent crashed: ${err.message}`);
    process.exit(1);
  });

  log.info('AesyClaw gateway started successfully');
}

function wireOutbound(services: Services): void {
  const { eventBus, channelManager } = services;
  eventBus.on('outbound', async (msg: OutboundMessage) => {
    const channel = channelManager.get(msg.channel);
    if (channel) {
      try {
        await channel.send(msg);
      } catch (error: unknown) {
        log.error(`Failed to send: ${normalizeError(error)}`);
      }
    } else {
      log.warn(`Channel ${msg.channel} not found`);
    }
  });
}

function setupConfigReload(services: Services): void {
  const { agent, apiServer } = services;
  let currentConfig = services.config;

  ConfigLoader.onReload(async (newConfig) => {
    log.info('Config reload triggered');

    const oldProvider = currentConfig.agent.defaults.provider;
    const newProvider = newConfig.agent.defaults.provider;
    const oldModel = currentConfig.agent.defaults.model;
    const newModel = newConfig.agent.defaults.model;

    if (oldProvider !== newProvider ||
        newConfig.providers[newProvider]?.apiBase !== currentConfig.providers[oldProvider]?.apiBase ||
        oldModel !== newModel) {
      log.info('Provider/model changed, updating agent');
      const newProviderInstance = createProvider(newProvider, newConfig.providers[newProvider]);
      agent.updateProvider(newProviderInstance, newModel);
    }

    currentConfig = newConfig;
    if (apiServer) {
      apiServer.updateConfig(currentConfig);
    }
  });
}

async function startChannels(services: Services): Promise<void> {
  const { channelManager } = services;
  try {
    await Promise.race([
      channelManager.startAll(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Channel start timeout')), CONSTANTS.CHANNEL_START_TIMEOUT)
      )
    ]);
  } catch (error) {
    log.error('Channel start failed:', error);
  }
  log.info('Channels started');
}

function setupSignalHandlers(services: Services): void {
  const shutdown = async () => {
    log.info('Shutting down...');
    const { agent, channelManager, sessionManager, cronService } = services;
    agent.stop();
    await channelManager.stopAll();
    await (cronService as any).stop?.();
    await sessionManager.close();
    ConfigLoader.stopWatching();
    log.info('All services stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
