import { pathResolver } from './platform/utils/paths.js';
import { sqliteManager } from './platform/db/sqlite-manager.js';
import { configManager } from './features/config/config-manager.js';
import { logger } from './platform/observability/logger.js';
import { ToolRegistry } from './platform/tools/registry.js';
import { McpClientManager } from './platform/tools/mcp/mcp-client-manager.js';
import { pluginManager } from './features/plugins/plugin-manager.js';
import { ChannelPipeline } from './agent/core/pipeline.js';
import { configInjectionMiddleware } from './middlewares/config.middleware.js';
import { sessionMiddleware } from './middlewares/session.middleware.js';
import { agentMiddleware } from './middlewares/agent.middleware.js';
import { skillManager, loadSkillTool, SkillManager } from './features/skills/index.js';
import { cronJobScheduler, initializePromptExecutor } from './features/cron/index.js';
import { commandMiddleware, registerSystemCommands } from './features/commands/index.js';
import { roleManager } from './features/roles/role-manager.js';
import { subAgentTools } from './features/subagent/index.js';
import { channelManager, ChannelPluginManager } from './channels/channel-manager.js';
import { sessionRegistry, SessionRegistry } from './agent/core/session/index.js';

export interface BootstrapOptions {
  skipDb?: boolean;
  skipConfig?: boolean;
  skipPlugins?: boolean;
  skipMCP?: boolean;
  skipSkills?: boolean;
  skipCron?: boolean;
  skipRoles?: boolean;
  skipSubAgents?: boolean;
  skipChannels?: boolean;
}

export class Bootstrap {
  private static initialized: boolean = false;
  private static toolRegistry: ToolRegistry | null = null;
  private static pipeline: ChannelPipeline | null = null;
  private static mcpManager: McpClientManager | null = null;

  static async initialize(options: BootstrapOptions = {}): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, 'AesyClaw starting...');

      logger.info({}, '[1/11] Initializing PathResolver...');
      pathResolver.initialize();

      if (!options.skipConfig) {
        logger.info({}, '[2/11] Loading configuration...');
        await configManager.initialize();
      }

      if (!options.skipDb) {
        logger.info({}, '[3/11] Initializing SQLite database...');
        sqliteManager.initialize();
      }

      logger.info({}, '[4/11] Initializing core components...');
      this.toolRegistry = ToolRegistry.getInstance();
      this.pipeline = new ChannelPipeline();

      if (!options.skipSkills) {
        logger.info({}, '[5/11] Initializing SkillManager...');
        await skillManager.initialize();
        this.toolRegistry.register(loadSkillTool);
        logger.info(skillManager.getStats(), 'Skills system loaded');
      }

      if (!options.skipRoles) {
        logger.info({}, '[6/12] Initializing RoleManager...');
        await roleManager.initialize();
        logger.info({ roleCount: roleManager.getAllRoles().length }, 'Role system loaded');
      }

      if (!options.skipSubAgents) {
        logger.info({}, '[7/12] Registering SubAgent tools...');
        for (const tool of subAgentTools) {
          this.toolRegistry.register(tool as any);
        }
        logger.info({ toolCount: subAgentTools.length }, 'SubAgent tools registered');
      }

      logger.info({}, '[8/12] Mounting ConfigInjectionMiddleware...');
      this.pipeline.use(configInjectionMiddleware.getMiddleware());

      logger.info({}, '[9/12] Registering system commands...');
      registerSystemCommands();
      this.pipeline.use(commandMiddleware);
      logger.info({}, 'Command system initialized');

      logger.info({}, '[9/12] Mounting SessionMiddleware...');
      this.pipeline.use(sessionMiddleware.getMiddleware());
      logger.info({}, 'Session middleware initialized');

      logger.info({}, '[9.5/12] Mounting AgentMiddleware...');
      this.pipeline.use(agentMiddleware.getMiddleware());
      logger.info({}, 'Agent middleware initialized');

      if (!options.skipPlugins) {
        logger.info({}, '[10/12] Initializing and loading plugins...');
        await pluginManager.initialize();
        logger.info({}, 'PluginManager initialized');
        const config = configManager.getConfig();
        if (config?.plugins?.plugins) {
          await pluginManager.scanAndLoad(config.plugins.plugins);
        }
        logger.info({ loadedPlugins: pluginManager.getPluginCount() }, 'Plugins system loaded');
      }

      if (!options.skipCron) {
        logger.info({}, '[11/13] Initializing Cron system with PromptExecutor...');
        await initializePromptExecutor();
        cronJobScheduler.start();
        const status = cronJobScheduler.isRunning();
        logger.info({ schedulerRunning: status }, 'Cron system initialized');
      }

      if (!options.skipMCP) {
        logger.info({}, '[12/13] Connecting MCP servers...');
        this.mcpManager = McpClientManager.getInstance(this.toolRegistry);
        const config = configManager.getConfig();
        if (config?.mcp?.servers) {
          await this.mcpManager.connectConfiguredServers(config.mcp.servers);
        }
      }

      if (!options.skipChannels) {
        logger.info({}, '[13/13] Loading channel plugins...');
        const config = configManager.getConfig();
        if (config?.channels) {
          await this.loadChannelPlugins(config.channels, this.pipeline);
        } else {
          logger.info({}, 'No channels configured, skipping channel plugin loading');
        }
      }

      this.initialized = true;
      logger.info({}, 'AesyClaw started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack }, 'Bootstrap failed');
      throw error;
    }
  }

  private static async loadChannelPlugins(channels: Record<string, unknown>, pipeline: any): Promise<void> {
    channelManager.setPipeline(pipeline);

    if (channels.onebot) {
      try {
        const { onebotPlugin } = await import('../plugins/plugin_channel_onebot/index.js');
        await channelManager.registerChannel(onebotPlugin, channels.onebot);
        logger.info({ channelName: 'onebot' }, 'OneBot channel plugin loaded');
      } catch (error) {
        logger.error({ error, channel: 'onebot' }, 'Failed to load OneBot channel plugin');
      }
    }

    logger.info({ loadedChannels: channelManager.getChannelCount() }, 'Channel system initialized');
  }

  static async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down AesyClaw...');

    try {
      channelManager.shutdown();
      logger.info({}, '[1/7] Channel Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Channel Manager');
    }

    try {
      cronJobScheduler.stop();
      logger.info({}, '[2/7] Cron scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Cron scheduler');
    }

    try {
      if (this.mcpManager) {
        this.mcpManager.shutdown();
        McpClientManager.resetInstance();
        logger.info({}, '[3/7] MCP Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping MCP Manager');
    }

    try {
      pluginManager.shutdown();
      logger.info({}, '[4/7] Plugin Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Plugin Manager');
    }

    try {
      sqliteManager.close();
      logger.info({}, '[5/7] SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }

    try {
      SkillManager.resetInstance();
      logger.info({}, '[6/8] SkillManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SkillManager');
    }

    try {
      roleManager.shutdown();
      logger.info({}, '[7/9] RoleManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping RoleManager');
    }

    try {
      sessionRegistry.shutdown();
      SessionRegistry.resetInstance();
      logger.info({}, '[8/9] SessionRegistry stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SessionRegistry');
    }

    try {
      ChannelPluginManager.resetInstance();
      logger.info({}, '[9/9] ChannelPluginManager reset');
    } catch (error) {
      logger.error({ error }, 'Error resetting ChannelPluginManager');
    }

    this.toolRegistry = null;
    this.pipeline = null;
    this.mcpManager = null;
    this.initialized = false;

    logger.info({}, 'AesyClaw shutdown completed');
  }

  static isInitialized(): boolean {
    return this.initialized;
  }

  static async restart(options: BootstrapOptions = {}): Promise<void> {
    await this.shutdown();
    await this.initialize(options);
  }

  static getToolRegistry(): ToolRegistry | null {
    return this.toolRegistry;
  }

  static getPipeline(): ChannelPipeline | null {
    return this.pipeline;
  }

  static getStatus(): {
    initialized: boolean;
    pathResolver: boolean;
    configManager: boolean;
    sqliteManager: boolean;
    toolRegistry: {
      totalTools: number;
    };
    skills: {
      total: number;
      system: number;
      user: number;
    };
    roles: {
      total: number;
    };
    sessions: {
      total: number;
      byChannel: Record<string, number>;
      byType: Record<string, number>;
    };
    mcpServers: number;
    plugins: number;
    channels: number;
    cron: {
      running: boolean;
      scheduledTasks: number;
    };
  } {
    const toolStats = this.toolRegistry?.getStats() || { totalTools: 0 };
    const skillStats = skillManager.isInitialized() ? skillManager.getStats() : { total: 0, system: 0, user: 0 };
    const mcpServers = this.mcpManager?.getConnectedServers() || [];
    const plugins = pluginManager?.getLoadedPlugins() || [];
    const roleStats = roleManager.isInitialized() ? { total: roleManager.getAllRoles().length } : { total: 0 };
    const sessionStats = sessionRegistry.getStats();

    return {
      initialized: this.initialized,
      pathResolver: pathResolver.isInitialized(),
      configManager: configManager.isInitialized(),
      sqliteManager: sqliteManager.isInitialized(),
      toolRegistry: {
        totalTools: toolStats.totalTools,
      },
      skills: skillStats,
      roles: roleStats,
      sessions: sessionStats,
      mcpServers: mcpServers.filter(s => s.connected).length,
      plugins: plugins.length,
      channels: channelManager.getChannelCount(),
      cron: {
        running: cronJobScheduler.isRunning(),
        scheduledTasks: cronJobScheduler.getScheduledTaskCount(),
      },
    };
  }
}

export async function bootstrap(options?: BootstrapOptions): Promise<void> {
  return Bootstrap.initialize(options);
}

export async function shutdown(): Promise<void> {
  return Bootstrap.shutdown();
}
