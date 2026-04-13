import * as path from 'path';
import * as fs from 'fs';
import { agentMessageStage } from '@/agent/runtime/agent-message-stage.js';
import { getSessionForCommandContext, sessionMessageStage, sessionRegistry, type SessionRegistry } from '@/agent/session/session-runtime.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import { subAgentTools } from '@/agent/subagent/subagent-tools.js';
import { channelManager } from '@/channels/channel-manager.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import type { IPluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { commandMiddleware } from '@/features/commands/command-middleware.js';
import { commandRegistry } from '@/features/commands/command-registry.js';
import { helpCommandGroup } from '@/features/commands/help-command-group.js';
import { sessionCommandGroup } from '@/features/commands/session-command-group.js';
import { configMessageStage } from '@/features/config/config-message-stage.js';
import { configManager } from '@/features/config/config-manager.js';
import { initializePromptExecutor } from '@/features/cron/index.js';
import { createPluginCommandGroup } from '@/features/plugins/plugin-command-group.js';
import { createPluginManager } from '@/features/plugins/create-plugin-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { createRoleCommandGroup } from '@/features/roles/role-command-group.js';
import { cronJobScheduler } from '@/platform/db/cron-scheduler.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { createMultimodalTools } from '@/platform/tools/multimodal-tools.js';
import { McpClientManager } from '@/platform/tools/mcp/mcp-client-manager.js';
import { ToolRegistry, toolRegistry as sharedToolRegistry } from '@/platform/tools/registry.js';
import { pathResolver } from '@/platform/utils/paths.js';

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

let pipeline: ChannelPipeline | null = null;
let toolRegistryInstance: ToolRegistry | null = null;
let sessionRegistryInstance: SessionRegistry | null = null;

export const pluginManager = createPluginManager(sharedToolRegistry, {
  commandRegistrar: commandRegistry,
  configStore: configManager,
});

export function getHookRuntime(): IPluginHookRuntime {
  return pluginManager;
}

function buildSystemCommands(): CommandDefinition[] {
  return [
    ...helpCommandGroup,
    ...createPluginCommandGroup({
      getPluginCommands: () => commandRegistry.getPluginCommands(),
      enablePlugin: (pluginName) => pluginManager.enablePlugin(pluginName),
      disablePlugin: (pluginName) => pluginManager.disablePlugin(pluginName),
    }),
    ...sessionCommandGroup,
    ...createRoleCommandGroup({
      getSessionForCommand: getSessionForCommandContext,
    }),
  ];
}

function registerSystemCommands(): void {
  const systemCommands = buildSystemCommands();
  for (const command of systemCommands) {
    commandRegistry.register(command);
  }
  logger.info({ count: systemCommands.length }, '系统命令已注册');
}

export class Bootstrap {
  private static initialized: boolean = false;
  private static mcpManager: McpClientManager | null = null;
  private static configChangeUnsubscribe: (() => void) | null = null;
  private static mcpHotReloadEnabled: boolean = false;
  private static channelHotReloadEnabled: boolean = false;

  static async initialize(options: BootstrapOptions = {}): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, 'AesyClaw starting...');

      logger.info({}, '[1/16] Initializing PathResolver...');
      pathResolver.initialize();

      if (!options.skipConfig) {
        logger.info({}, '[2/16] Loading configuration...');
        await configManager.initialize();
      }

      if (!options.skipDb) {
        logger.info({}, '[3/16] Initializing SQLite database...');
        sqliteManager.initialize();
      }

      logger.info({}, '[4/16] Initializing Aesyiu core components...');

      toolRegistryInstance = sharedToolRegistry;
      sessionRegistryInstance = sessionRegistry;

      const { speechToTextTool, imageUnderstandingTool } = createMultimodalTools(
        () => configManager.config
      );

      pipeline = new ChannelPipeline(pluginManager);

      if (!options.skipSkills) {
        logger.info({}, '[5/16] Initializing SkillManager...');
        const { skillManager } = await import('@/features/skills/skill-manager.js');
        await skillManager.initialize();
        logger.info(skillManager.getStats(), 'Skills system loaded');
      }

      if (!options.skipRoles) {
        logger.info({}, '[6/16] Initializing RoleManager...');
        await roleManager.initialize();
        logger.info({ roleCount: roleManager.getAllRoles().length }, 'Role system loaded');
      }

      if (!options.skipSubAgents) {
        logger.info({}, '[7/16] Registering SubAgent tools...');
        for (const tool of subAgentTools) {
          toolRegistryInstance.register(tool);
        }
        logger.info({ toolCount: subAgentTools.length }, 'SubAgent tools registered');
      }

      logger.info({}, '[8/16] Registering Multimodal tools...');
      toolRegistryInstance.register(speechToTextTool);
      toolRegistryInstance.register(imageUnderstandingTool);
      logger.info({}, 'Multimodal tools registered');

      logger.info({}, '[9/16] Mounting ConfigInjectionMiddleware...');
      pipeline.use(configMessageStage);

      logger.info({}, '[10/16] Registering system commands...');
      registerSystemCommands();
      pipeline.use(commandMiddleware);
      logger.info({}, 'Command system initialized');

      logger.info({}, '[11/16] Mounting SessionMiddleware...');
      pipeline.use(sessionMessageStage);
      logger.info({}, 'Session middleware initialized');

      logger.info({}, '[12/16] Mounting AgentMiddleware...');
      pipeline.use(agentMessageStage);
      logger.info({}, 'Agent middleware initialized');

      if (!options.skipPlugins) {
        logger.info({}, '[13/16] Initializing and loading plugins...');
        await pluginManager.initialize();
        logger.info({}, 'PluginManager initialized');
        const config = configManager.config;
        await pluginManager.scanAndLoad(config?.plugins || []);
        logger.info({ loadedPlugins: pluginManager.getPluginCount() }, 'Plugins system loaded');
      }

      if (!options.skipCron) {
        logger.info({}, '[14/16] Initializing Cron system with PromptExecutor...');
        await initializePromptExecutor();
        cronJobScheduler.start();
        const status = cronJobScheduler.isRunning();
        logger.info({ schedulerRunning: status }, 'Cron system initialized');
      }

      if (!options.skipMCP) {
        logger.info({}, '[15/16] Connecting MCP servers...');
        this.mcpManager = McpClientManager.getInstance(sharedToolRegistry);
        const config = configManager.config;
        if (config?.mcp?.servers) {
          await this.mcpManager.connectConfiguredServers(config.mcp.servers);
        }
      }

      if (!options.skipChannels) {
        logger.info({}, '[16/16] Loading channel plugins...');
        const config = configManager.config;
        await this.loadChannelPlugins(config?.channels || {});
      }

      await configManager.syncAllDefaultConfigs();

      if (!options.skipConfig) {
        this.registerConfigChangeListener({
          mcp: !options.skipMCP,
          channels: !options.skipChannels,
        });
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

  private static async loadChannelPlugins(channels: Record<string, unknown>): Promise<void> {
    if (!pipeline) {
      logger.error({}, 'Pipeline not initialized, cannot load channel plugins');
      return;
    }
    channelManager.setPipeline(pipeline);

    const pluginsDir = path.join(process.cwd(), 'plugins');

    if (!fs.existsSync(pluginsDir)) {
      logger.warn({ pluginsDir }, 'Plugins directory not found, skipping channel plugin loading');
      return;
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('channel_')) {
        const pluginName = entry.name;

        try {
          const pluginPath = path.join(pluginsDir, pluginName, 'index.ts');
          const normalizedPath = this.normalizePath(pluginPath);
          const { default: channelPlugin } = await import(normalizedPath);

          const packageJsonPath = path.join(pluginsDir, pluginName, 'package.json');
          if (fs.existsSync(packageJsonPath)) {
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            if (pkg.name && pkg.name !== channelPlugin.name) {
              throw new Error(
                `Channel plugin name mismatch: package.json name is "${pkg.name}" but plugin.name is "${channelPlugin.name}". They must match.`
              );
            }
          }

          const channelConfig = channels[channelPlugin.name] as Record<string, unknown> | undefined;

          await channelManager.registerChannel(channelPlugin, channelConfig || {});
          logger.info({ channelName: channelPlugin.name }, `${channelPlugin.name} channel plugin loaded`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.error({ error: errorMessage, stack: errorStack, pluginName }, 'Failed to load channel plugin');
        }
      }
    }

    logger.info({ loadedChannels: channelManager.getChannelCount() }, 'Channel system initialized');
  }

  private static registerConfigChangeListener(options: { mcp: boolean; channels: boolean }): void {
    if (this.configChangeUnsubscribe) {
      this.configChangeUnsubscribe();
      this.configChangeUnsubscribe = null;
    }

    this.mcpHotReloadEnabled = options.mcp;
    this.channelHotReloadEnabled = options.channels;

    this.configChangeUnsubscribe = configManager.onConfigChange(async (nextConfig, previousConfig) => {
      const mcpChanged = JSON.stringify(previousConfig.mcp?.servers || []) !== JSON.stringify(nextConfig.mcp?.servers || []);
      const channelsChanged = JSON.stringify(previousConfig.channels || {}) !== JSON.stringify(nextConfig.channels || {});

      if (mcpChanged && this.mcpHotReloadEnabled && this.mcpManager) {
        logger.info({}, 'MCP config changed, reconnecting MCP servers');
        await this.mcpManager.shutdown();
        await this.mcpManager.connectConfiguredServers(nextConfig.mcp?.servers || []);
      }

      if (channelsChanged && this.channelHotReloadEnabled) {
        logger.info({}, 'Channel config changed, reloading channel plugins');
        await channelManager.shutdown();
        await this.loadChannelPlugins(nextConfig.channels || {});
      }
    });
  }

  private static normalizePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return `file:///${filePath.replace(/\\/g, '/')}`;
    }
    return filePath;
  }

  static async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down AesyClaw...');

    if (this.configChangeUnsubscribe) {
      this.configChangeUnsubscribe();
      this.configChangeUnsubscribe = null;
    }

    this.mcpHotReloadEnabled = false;
    this.channelHotReloadEnabled = false;

    try {
      await channelManager.shutdown();
      logger.info({}, '[1/9] Channel Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Channel Manager');
    }

    try {
      cronJobScheduler.stop();
      logger.info({}, '[2/9] Cron scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Cron scheduler');
    }

    try {
      if (this.mcpManager) {
        await this.mcpManager.shutdown();
        logger.info({}, '[3/9] MCP Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping MCP Manager');
    }

    try {
      pluginManager.shutdown();
      logger.info({}, '[4/9] Plugin Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Plugin Manager');
    }

    try {
      sqliteManager.close();
      logger.info({}, '[5/9] SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }

    try {
      const { skillManager } = await import('./features/skills/skill-manager.js');
      await skillManager.shutdown();
      logger.info({}, '[6/9] SkillManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SkillManager');
    }

    try {
      const { roleManager } = await import('./features/roles/role-manager.js');
      roleManager.shutdown();
      logger.info({}, '[7/9] RoleManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping RoleManager');
    }

    try {
      if (sessionRegistryInstance) {
        sessionRegistryInstance.shutdown();
      }
      logger.info({}, '[8/9] SessionRegistry stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SessionRegistry');
    }

    try {
      await channelManager.shutdown();
      logger.info({}, '[9/9] ChannelPluginManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping ChannelPluginManager');
    }

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
    return toolRegistryInstance;
  }

  static getPipeline(): ChannelPipeline | null {
    return pipeline;
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
    };
    mcpServers: number;
    plugins: number;
    channels: number;
    cron: {
      running: boolean;
      scheduledTasks: number;
    };
  } {
    const toolStats = toolRegistryInstance?.getStats() ?? { totalTools: 0 };
    const mcpServers = this.mcpManager?.getConnectedServers() || [];
    const plugins = pluginManager?.getLoadedPlugins() || [];
      const roleStats = roleManager.isInitialized() ? { total: roleManager.getAllRoles().length } : { total: 0 };

    return {
      initialized: this.initialized,
      pathResolver: pathResolver.isInitialized(),
      configManager: configManager.isInitialized(),
      sqliteManager: sqliteManager.isInitialized(),
      toolRegistry: {
        totalTools: toolStats.totalTools,
      },
      skills: { total: 0, system: 0, user: 0 },
      roles: roleStats,
      sessions: { total: 0 },
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

export { pipeline, toolRegistryInstance as toolRegistry };
