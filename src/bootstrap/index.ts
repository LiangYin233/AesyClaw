import { randomUUID } from 'crypto';
import { ConfigLoader } from '../config/loader.js';
import { ServiceFactory } from './ServiceFactory.js';
import { LifecycleManager } from './LifecycleManager.js';
import { logger } from '../logger/index.js';
import type { Config } from '../types.js';
import type { CronJob, CronSchedule } from '../cron/index.js';
import type { OutboundMessage } from '../types.js';
import { parseTarget } from './ServiceFactory.js';

export async function bootstrap(port: number): Promise<void> {
  const log = logger.child({ prefix: 'Bootstrap' });

  const config = await ConfigLoader.load() as Config;
  const workspace = process.cwd();

  log.info('Starting AesyClaw...');
  log.info(`Workspace: ${workspace}`);
  log.info(`Provider: ${config.agent.defaults.provider}, Model: ${config.agent.defaults.model}`);

  const factory = new ServiceFactory();

  const services = await factory.create({
    workspace,
    config,
    port,
    onCronJob: async (job: CronJob) => {
      log.info(`Cron job triggered: ${job.name}`);

      const { provider, toolRegistry, sessionManager, config: cronConfig, pluginManager, eventBus } = services;

      const { AgentLoop } = await import('../agent/AgentLoop.js');

      const tempAgent = new AgentLoop(
        eventBus,
        provider,
        toolRegistry,
        sessionManager,
        workspace,
        cronConfig.agent.defaults.systemPrompt,
        cronConfig.agent.defaults.maxToolIterations,
        cronConfig.agent.defaults.model,
        'global',
        0
      );

      const sessionKey = `cron:${job.id}:${randomUUID().slice(0, 8)}`;

      try {
        const response = await tempAgent.processDirect(job.payload.detail, sessionKey);

        const targetChannel = job.payload.channel || 'onebot';
        const target = job.payload.target;

        if (target) {
          const parsed = parseTarget(target);
          if (!parsed) {
            log.error(`Invalid target format: ${target}`);
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
          log.info(`Cron job response sent to ${target}`);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(`Cron job failed: ${message}`);
      }
    }
  });

  const lifecycle = new LifecycleManager();
  lifecycle.setServices(services);
  await lifecycle.start();

  log.info('AesyClaw gateway started successfully');
}
