import type { EventBus } from '../bus/EventBus.js';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { APIServer } from '../api/server.js';
import type { CronService } from '../cron/CronService.js';
import type { ConfigLoader } from '../config/loader.js';
import { logger } from '../logger/index.js';
import type { OutboundMessage, Config } from '../types.js';
import type { ChannelManager as ChannelManagerType } from '../channels/index.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { createProvider } from '../providers/index.js';
import type { Services } from './ServiceFactory.js';

export class LifecycleManager {
  private log = logger.child({ prefix: 'Lifecycle' });
  private services: Services | null = null;
  private configLoader: any = null;

  setServices(services: Services): void {
    this.services = services;
  }

  async start(): Promise<void> {
    if (!this.services) {
      throw new Error('Services not initialized');
    }

    const { channelManager, agent, eventBus } = this.services;

    await this.setupOutboundHandler(eventBus, channelManager);
    await this.setupConfigReload();

    await this.startChannels(channelManager);

    this.setupSignalHandlers();

    this.runAgent(agent);
  }

  private async setupOutboundHandler(eventBus: EventBus, channelManager: ChannelManagerType): Promise<void> {
    eventBus.on('outbound', async (msg: OutboundMessage) => {
      this.log.debug(`Outbound: ${msg.channel}:${msg.chatId}`);
      const channel = channelManager.get(msg.channel);
      if (channel) {
        try {
          await channel.send(msg);
        } catch (error: unknown) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.log.error(`Failed to send: ${errMsg}`);
        }
      } else {
        this.log.warn(`Channel ${msg.channel} not found`);
      }
    });
    this.log.debug('Outbound handler registered');
  }

  private async setupConfigReload(): Promise<void> {
    if (!this.services) return;

    const { config, agent, apiServer } = this.services;
    let currentConfig = config;

    const { ConfigLoader } = await import('../config/loader.js');
    this.configLoader = ConfigLoader;

    ConfigLoader.onReload(async (newConfig) => {
      this.log.info('Config reload triggered');

      const oldProvider = currentConfig.agent.defaults.provider;
      const newProvider = newConfig.agent.defaults.provider;
      const oldModel = currentConfig.agent.defaults.model;
      const newModel = newConfig.agent.defaults.model;

      if (oldProvider !== newProvider ||
          newConfig.providers[newProvider]?.apiBase !== currentConfig.providers[oldProvider]?.apiBase ||
          oldModel !== newModel) {
        this.log.info('Provider/model changed, updating agent');
        const newProviderConfig = newConfig.providers[newProvider];
        const newProviderInstance = createProvider(newProvider, newProviderConfig);
        agent.updateProvider(newProviderInstance, newModel);
      }

      currentConfig = newConfig;
      (apiServer as any).updateConfig(currentConfig);
    });

    this.log.debug('Config reload handler registered');
  }

  private async startChannels(channelManager: ChannelManager): Promise<void> {
    const { CONSTANTS } = await import('../constants/index.js');

    try {
      await Promise.race([
        channelManager.startAll(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Channel start timeout')),
            CONSTANTS.CHANNEL_START_TIMEOUT)
        )
      ]);
    } catch (error) {
      this.log.error('Channel start failed:', error);
    }
    this.log.info('Channels started');
  }

  private setupSignalHandlers(): void {
    process.on('SIGINT', async () => {
      this.log.info('Received SIGINT, shutting down...');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.log.info('Received SIGTERM, shutting down...');
      await this.shutdown();
      process.exit(0);
    });

    this.log.debug('Signal handlers registered');
  }

  private runAgent(agent: AgentLoop): void {
    agent.run().catch((err: Error) => {
      this.log.error(`Agent crashed: ${err.message}`);
      process.exit(1);
    });
  }

  async shutdown(): Promise<void> {
    if (!this.services) {
      this.log.warn('No services to shutdown');
      return;
    }

    const { agent, channelManager, sessionManager, cronService, mcpManager } = this.services;

    this.log.info('Stopping services...');

    agent.stop();
    await channelManager.stopAll();
    await (cronService as any).stop?.();

    if (mcpManager) {
      // MCP manager will be cleaned up with process exit
    }

    await sessionManager.close();

    if (this.configLoader) {
      this.configLoader.stopWatching();
    }

    this.log.info('All services stopped');
  }
}
