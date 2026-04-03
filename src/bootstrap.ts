import { pathResolver } from './platform/utils/paths.js';
import { sqliteManager } from './platform/db/sqlite-manager.js';
import { configManager } from './features/config/config-manager.js';
import { logger } from './platform/observability/logger.js';
import { WebUIAdapter } from './channels/webui/adapter.js';
import { ToolRegistry } from './platform/tools/registry.js';
import { McpClientManager } from './platform/tools/mcp/mcp-client-manager.js';
import { pluginManager } from './features/plugins/plugin-manager.js';
import { ChannelPipeline } from './agent/core/pipeline.js';
import { configInjectionMiddleware } from './middlewares/config.middleware.js';
import { skillManager, loadSkillTool, SkillManager } from './features/skills/index.js';
import { cronJobScheduler, initializePromptExecutor } from './features/cron/index.js';
import { commandMiddleware, registerSystemCommands } from './features/commands/index.js';

export interface BootstrapOptions {
  skipDb?: boolean;
  skipConfig?: boolean;
  skipWebUI?: boolean;
  skipPlugins?: boolean;
  skipMCP?: boolean;
  skipSkills?: boolean;
  skipCron?: boolean;
  webUIPort?: number;
}

export class Bootstrap {
  private static initialized: boolean = false;
  private static webUIAdapter: WebUIAdapter | null = null;
  private static toolRegistry: ToolRegistry | null = null;
  private static pipeline: ChannelPipeline | null = null;
  private static mcpManager: McpClientManager | null = null;

  static async initialize(options: BootstrapOptions = {}): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, '========================================');
      logger.info({}, '🚀 AesyClaw Agent System Starting...');
      logger.info({}, '========================================');

      logger.info({}, '[1/10] Initializing PathResolver...');
      pathResolver.initialize();

      if (!options.skipConfig) {
        logger.info({}, '[2/10] Loading configuration...');
        await configManager.initialize();
      }

      if (!options.skipDb) {
        logger.info({}, '[3/10] Initializing SQLite database...');
        sqliteManager.initialize();
      }

      logger.info({}, '[4/10] Initializing core components...');
      this.toolRegistry = ToolRegistry.getInstance();
      this.pipeline = new ChannelPipeline();

      if (!options.skipSkills) {
        logger.info({}, '[5/10] Initializing SkillManager...');
        await skillManager.initialize();
        this.toolRegistry.register(loadSkillTool);
        logger.info(skillManager.getStats(), '✅ Skills system loaded');
      }

      logger.info({}, '[6/10] Mounting ConfigInjectionMiddleware...');
      this.pipeline.use(configInjectionMiddleware.getMiddleware());

      logger.info({}, '[7/10] Registering system commands...');
      registerSystemCommands();
      this.pipeline.use(commandMiddleware);
      logger.info({}, '✅ Command system initialized');

      if (!options.skipPlugins) {
        logger.info({}, '[8/10] Initializing and loading plugins...');
        await pluginManager.initialize();
        const config = configManager.getConfig();
        if (config?.plugins?.plugins) {
          await pluginManager.scanAndLoad(config.plugins.plugins);
        }
        logger.info({ loadedPlugins: pluginManager.getPluginCount() }, '✅ Plugins system loaded');
      }

      if (!options.skipCron) {
        logger.info({}, '[9/10] Initializing Cron system with PromptExecutor...');
        await initializePromptExecutor();
        cronJobScheduler.start();
        const status = cronJobScheduler.isRunning();
        logger.info({ schedulerRunning: status }, '✅ Cron system initialized');
      }

      if (!options.skipMCP) {
        logger.info({}, '[10/10] Connecting MCP servers...');
        this.mcpManager = McpClientManager.getInstance(this.toolRegistry);
        const config = configManager.getConfig();
        if (config?.mcp?.servers) {
          await this.mcpManager.connectConfiguredServers(config.mcp.servers);
        }
      }

      if (!options.skipWebUI) {
        logger.info({}, '[Extra] Starting WebUI API Server...');
        this.webUIAdapter = WebUIAdapter.getInstance();
        await this.webUIAdapter.initialize();
        await this.webUIAdapter.start(options.webUIPort);
      }

      this.initialized = true;
      logger.info({}, '========================================');
      logger.info({}, '✅ AesyClaw bootstrap completed successfully');
      logger.info({}, '========================================');
    } catch (error) {
      logger.error({ error }, '❌ Bootstrap failed');
      throw error;
    }
  }

  static async shutdown(): Promise<void> {
    logger.info({}, '========================================');
    logger.info({}, '🛑 Shutting down AesyClaw...');
    logger.info({}, '========================================');

    try {
      cronJobScheduler.stop();
      logger.info({}, '[1/6] Cron scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Cron scheduler');
    }

    try {
      if (this.mcpManager) {
        this.mcpManager.shutdown();
        McpClientManager.resetInstance();
        logger.info({}, '[2/6] MCP Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping MCP Manager');
    }

    try {
      pluginManager.shutdown();
      logger.info({}, '[3/6] Plugin Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Plugin Manager');
    }

    try {
      if (this.webUIAdapter) {
        await this.webUIAdapter.stop();
        this.webUIAdapter = null;
        logger.info({}, '[4/6] WebUIAdapter stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping WebUIAdapter');
    }

    try {
      sqliteManager.close();
      logger.info({}, '[5/6] SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }

    try {
      SkillManager.resetInstance();
      logger.info({}, '[6/6] SkillManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SkillManager');
    }

    this.toolRegistry = null;
    this.pipeline = null;
    this.mcpManager = null;
    this.initialized = false;

    logger.info({}, '========================================');
    logger.info({}, '✅ AesyClaw shutdown completed');
    logger.info({}, '========================================');
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
    mcpServers: number;
    plugins: number;
    cron: {
      running: boolean;
      scheduledTasks: number;
    };
    webUI?: {
      running: boolean;
      port: number;
      connectedClients: number;
    };
  } {
    const toolStats = this.toolRegistry?.getStats() || { totalTools: 0 };
    const skillStats = skillManager.isInitialized() ? skillManager.getStats() : { total: 0, system: 0, user: 0 };
    const mcpServers = this.mcpManager?.getConnectedServers() || [];
    const plugins = pluginManager?.getLoadedPlugins() || [];

    return {
      initialized: this.initialized,
      pathResolver: pathResolver.isInitialized(),
      configManager: configManager.isInitialized(),
      sqliteManager: sqliteManager.isInitialized(),
      toolRegistry: {
        totalTools: toolStats.totalTools,
      },
      skills: skillStats,
      mcpServers: mcpServers.filter(s => s.connected).length,
      plugins: plugins.length,
      cron: {
        running: cronJobScheduler.isRunning(),
        scheduledTasks: cronJobScheduler.getScheduledTaskCount(),
      },
      webUI: this.webUIAdapter ? {
        running: this.webUIAdapter.isServerRunning(),
        port: this.webUIAdapter.getPort(),
        connectedClients: this.webUIAdapter.getConnectedClientsCount(),
      } : undefined,
    };
  }
}

export async function bootstrap(options?: BootstrapOptions): Promise<void> {
  return Bootstrap.initialize(options);
}

export async function shutdown(): Promise<void> {
  return Bootstrap.shutdown();
}
