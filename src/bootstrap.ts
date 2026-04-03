import { pathResolver } from './platform/utils/paths.js';
import { sqliteManager } from './platform/db/sqlite-manager.js';
import { configManager } from './features/config/config-manager.js';
import { logger } from './platform/observability/logger.js';
import { WebUIAdapter } from './channels/webui/adapter.js';
import { ToolRegistry } from './platform/tools/registry.js';
import { McpClientManager } from './platform/tools/mcp/mcp-client-manager.js';
import { PluginManager } from './features/plugins/plugin-manager.js';
import { ChannelPipeline } from './agent/core/pipeline.js';
import { configInjectionMiddleware } from './middlewares/config.middleware.js';

export interface BootstrapOptions {
  skipDb?: boolean;
  skipConfig?: boolean;
  skipWebUI?: boolean;
  skipPlugins?: boolean;
  skipMCP?: boolean;
  webUIPort?: number;
}

export class Bootstrap {
  private static initialized: boolean = false;
  private static webUIAdapter: WebUIAdapter | null = null;
  private static toolRegistry: ToolRegistry | null = null;
  private static pipeline: ChannelPipeline | null = null;
  private static mcpManager: McpClientManager | null = null;
  private static pluginManager: PluginManager | null = null;

  static async initialize(options: BootstrapOptions = {}): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, '========================================');
      logger.info({}, '🚀 AesyClaw Agent System Starting...');
      logger.info({}, '========================================');

      logger.info({}, '[1/7] Initializing PathResolver...');
      pathResolver.initialize();

      if (!options.skipConfig) {
        logger.info({}, '[2/7] Loading configuration...');
        await configManager.initialize();
      }

      if (!options.skipDb) {
        logger.info({}, '[3/7] Initializing SQLite database...');
        sqliteManager.initialize();
      }

      logger.info({}, '[4/7] Initializing core components...');
      this.toolRegistry = ToolRegistry.getInstance();
      this.pipeline = new ChannelPipeline();

      logger.info({}, '[5/7] Mounting ConfigInjectionMiddleware...');
      this.pipeline.use(configInjectionMiddleware.getMiddleware());

      if (!options.skipPlugins) {
        logger.info({}, '[6/7] Loading plugins...');
        this.pluginManager = PluginManager.getInstance(this.toolRegistry, this.pipeline);
        const config = configManager.getConfig();
        if (config?.plugins?.plugins) {
          await this.pluginManager.loadEnabledPlugins(config.plugins.plugins);
        }
      }

      if (!options.skipMCP) {
        logger.info({}, '[7/7] Connecting MCP servers...');
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
      if (this.mcpManager) {
        this.mcpManager.shutdown();
        McpClientManager.resetInstance();
        logger.info({}, '[1/4] MCP Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping MCP Manager');
    }

    try {
      if (this.pluginManager) {
        this.pluginManager.shutdown();
        PluginManager.resetInstance();
        logger.info({}, '[2/4] Plugin Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping Plugin Manager');
    }

    try {
      if (this.webUIAdapter) {
        await this.webUIAdapter.stop();
        this.webUIAdapter = null;
        logger.info({}, '[3/4] WebUIAdapter stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping WebUIAdapter');
    }

    try {
      sqliteManager.close();
      logger.info({}, '[4/4] SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }

    this.toolRegistry = null;
    this.pipeline = null;
    this.mcpManager = null;
    this.pluginManager = null;
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
    mcpServers: number;
    plugins: number;
    webUI?: {
      running: boolean;
      port: number;
      connectedClients: number;
    };
  } {
    const toolStats = this.toolRegistry?.getStats() || { totalTools: 0 };
    const mcpServers = this.mcpManager?.getConnectedServers() || [];
    const plugins = this.pluginManager?.getLoadedPlugins() || [];

    return {
      initialized: this.initialized,
      pathResolver: pathResolver.isInitialized(),
      configManager: configManager.isInitialized(),
      sqliteManager: sqliteManager.isInitialized(),
      toolRegistry: {
        totalTools: toolStats.totalTools,
      },
      mcpServers: mcpServers.filter(s => s.connected).length,
      plugins: plugins.length,
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
