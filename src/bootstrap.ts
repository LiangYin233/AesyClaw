import * as path from 'path';
import * as fs from 'fs';
import { agentMessageStage } from '@/agent/runtime/agent-message-stage.js';
import {
  getRoleInfoForCommandContext,
  sessionMessageStage,
  shutdownSessionRuntime,
  switchRoleForCommandContext,
} from '@/agent/session/session-runtime.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import { subAgentTools } from '@/agent/subagent/subagent-tools.js';
import type { IChannelPlugin } from '@/channels/channel-plugin.js';
import { ChannelPluginManager } from '@/channels/channel-manager.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import type { IPluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { commandMiddleware } from '@/features/commands/command-middleware.js';
import { commandRegistry } from '@/features/commands/command-registry.js';
import { helpCommandGroup } from '@/features/commands/help-command-group.js';
import { sessionCommandGroup } from '@/features/commands/session-command-group.js';
import { configMessageStage } from '@/features/config/config-message-stage.js';
import { configManager } from '@/features/config/config-manager.js';
import { initializePromptExecutor } from '@/features/cron/tools.js';
import { createPluginCommandGroup } from '@/features/plugins/plugin-command-group.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { createRoleCommandGroup } from '@/features/roles/role-command-group.js';
import { cronJobScheduler } from '@/platform/db/cron-scheduler.js';
import { sessionRepository } from '@/platform/db/repositories/session-repository.js';
import { sqliteManager } from '@/platform/db/sqlite-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { createMultimodalTools } from '@/platform/tools/multimodal-tools.js';
import { McpClientManager } from '@/platform/tools/mcp/mcp-client-manager.js';
import { toolRegistry as sharedToolRegistry } from '@/platform/tools/registry.js';
import { normalizeImportPath } from '@/platform/utils/import-path.js';
import {
  assertPackageNameMatchesExportedName,
  readPackageManifest,
} from '@/platform/utils/package-manifest.js';
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

export const pluginManager = new PluginManager(sharedToolRegistry, {
  commandRegistrar: commandRegistry,
  configStore: configManager,
});

export const channelManager = new ChannelPluginManager(configManager);

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
      getSessionForCommand: (ctx) => ({
        switchRole: (roleId) => switchRoleForCommandContext(ctx, roleId),
        getRoleInfo: () => getRoleInfoForCommandContext(ctx),
      }),
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

      const multimodalTools = await this.initializeRuntimeCore(options);
      await this.initializeSkills(options);
      await this.initializeRoles(options);
      this.registerSubAgentTools(options);
      this.registerMultimodalTools(multimodalTools);
      this.mountPipelineStages();
      await this.initializePlugins(options);
      await this.initializeCron(options);
      await this.initializeMcp(options);
      await this.initializeChannels(options);
      await this.finalizeInitialization(options);

      this.initialized = true;
      logger.info({}, 'AesyClaw started successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack }, 'Bootstrap failed');
      throw error;
    }
  }

  private static async initializeRuntimeCore(options: BootstrapOptions): Promise<ReturnType<typeof createMultimodalTools>> {
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

    const multimodalTools = createMultimodalTools(() => configManager.config);
    pipeline = new ChannelPipeline(pluginManager);

    return multimodalTools;
  }

  private static async initializeSkills(options: BootstrapOptions): Promise<void> {
    if (!options.skipSkills) {
      logger.info({}, '[5/16] Initializing SkillManager...');
      const { skillManager } = await import('@/features/skills/skill-manager.js');
      await skillManager.initialize();
      logger.info(skillManager.getStats(), 'Skills system loaded');
    }
  }

  private static async initializeRoles(options: BootstrapOptions): Promise<void> {
    if (!options.skipRoles) {
      logger.info({}, '[6/16] Initializing RoleManager...');
      await roleManager.initialize();
      logger.info({ roleCount: roleManager.getAllRoles().length }, 'Role system loaded');
    }
  }

  private static registerSubAgentTools(options: BootstrapOptions): void {
    if (!options.skipSubAgents) {
      logger.info({}, '[7/16] Registering SubAgent tools...');
      for (const tool of subAgentTools) {
        sharedToolRegistry.register(tool);
      }
      logger.info({ toolCount: subAgentTools.length }, 'SubAgent tools registered');
    }
  }

  private static registerMultimodalTools(multimodalTools: ReturnType<typeof createMultimodalTools>): void {
    logger.info({}, '[8/16] Registering Multimodal tools...');
    sharedToolRegistry.register(multimodalTools.speechToTextTool);
    sharedToolRegistry.register(multimodalTools.imageUnderstandingTool);
    logger.info({}, 'Multimodal tools registered');
  }

  private static mountPipelineStages(): void {
    logger.info({}, '[9/16] Mounting ConfigInjectionMiddleware...');
    pipeline?.use(configMessageStage);

    logger.info({}, '[10/16] Registering system commands...');
    registerSystemCommands();
    pipeline?.use(commandMiddleware);
    logger.info({}, 'Command system initialized');

    logger.info({}, '[11/16] Mounting SessionMiddleware...');
    pipeline?.use(sessionMessageStage);
    logger.info({}, 'Session middleware initialized');

    logger.info({}, '[12/16] Mounting AgentMiddleware...');
    pipeline?.use(agentMessageStage);
    logger.info({}, 'Agent middleware initialized');
  }

  private static async initializePlugins(options: BootstrapOptions): Promise<void> {
    if (!options.skipPlugins) {
      logger.info({}, '[13/16] Initializing and loading plugins...');
      await pluginManager.initialize();
      logger.info({}, 'PluginManager initialized');
      const config = configManager.config;
      await pluginManager.scanAndLoad(config?.plugins || []);
      logger.info({ loadedPlugins: pluginManager.getPluginCount() }, 'Plugins system loaded');
    }
  }

  private static async initializeCron(options: BootstrapOptions): Promise<void> {
    if (!options.skipCron) {
      logger.info({}, '[14/16] Initializing Cron system with PromptExecutor...');
      await initializePromptExecutor();
      cronJobScheduler.start();
      const status = cronJobScheduler.isRunning();
      logger.info({ schedulerRunning: status }, 'Cron system initialized');
    }
  }

  private static async initializeMcp(options: BootstrapOptions): Promise<void> {
    if (!options.skipMCP) {
      logger.info({}, '[15/16] Connecting MCP servers...');
      this.mcpManager = McpClientManager.getInstance(sharedToolRegistry);
      const config = configManager.config;
      if (config?.mcp?.servers) {
        await this.mcpManager.connectConfiguredServers(config.mcp.servers);
      }
    }
  }

  private static async initializeChannels(options: BootstrapOptions): Promise<void> {
    if (!options.skipChannels) {
      logger.info({}, '[16/16] Loading channel plugins...');
      const config = configManager.config;
      await this.loadChannelPlugins(config?.channels || {});
    }
  }

  private static async finalizeInitialization(options: BootstrapOptions): Promise<void> {
    await configManager.syncAllDefaultConfigs();

    if (!options.skipConfig) {
      this.registerConfigChangeListener({
        mcp: !options.skipMCP,
        channels: !options.skipChannels,
      });
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

    for (const entry of this.getChannelPluginEntries(pluginsDir)) {
      await this.loadChannelPluginEntry(pluginsDir, entry.name, channels);
    }

    logger.info({ loadedChannels: channelManager.getChannelCount() }, 'Channel system initialized');
  }

  private static getChannelPluginEntries(pluginsDir: string): fs.Dirent[] {
    return fs.readdirSync(pluginsDir, { withFileTypes: true }).filter(entry => {
      return entry.isDirectory() && entry.name.startsWith('channel_');
    });
  }

  private static async importChannelPlugin(pluginsDir: string, pluginName: string): Promise<IChannelPlugin> {
    const pluginPath = path.join(pluginsDir, pluginName, 'index.ts');
    const normalizedPath = normalizeImportPath(pluginPath);
    const { default: channelPlugin } = await import(normalizedPath);

    return channelPlugin;
  }

  private static validateChannelPlugin(pluginsDir: string, pluginName: string, channelPlugin: IChannelPlugin): void {
    const packageJsonPath = path.join(pluginsDir, pluginName, 'package.json');
    assertPackageNameMatchesExportedName(
      readPackageManifest(packageJsonPath),
      channelPlugin.name,
      'Channel plugin'
    );
  }

  private static async loadChannelPluginEntry(
    pluginsDir: string,
    pluginName: string,
    channels: Record<string, unknown>
  ): Promise<void> {
    try {
      const channelPlugin = await this.importChannelPlugin(pluginsDir, pluginName);
      this.validateChannelPlugin(pluginsDir, pluginName, channelPlugin);

      const channelConfig = (channels[channelPlugin.name] as Record<string, unknown> | undefined) || {};

      await channelManager.registerChannel(channelPlugin, channelConfig);
      logger.info({ channelName: channelPlugin.name }, `${channelPlugin.name} channel plugin loaded`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack, pluginName }, 'Failed to load channel plugin');
    }
  }

  private static registerConfigChangeListener(options: { mcp: boolean; channels: boolean }): void {
    if (this.configChangeUnsubscribe) {
      this.configChangeUnsubscribe();
      this.configChangeUnsubscribe = null;
    }

    this.mcpHotReloadEnabled = options.mcp;
    this.channelHotReloadEnabled = options.channels;

    this.configChangeUnsubscribe = configManager.onConfigChange(async (nextConfig, previousConfig) => {
      const mcpChanged = this.hasSerializedConfigChanged(
        previousConfig.mcp?.servers || [],
        nextConfig.mcp?.servers || []
      );
      const channelsChanged = this.hasSerializedConfigChanged(
        previousConfig.channels || {},
        nextConfig.channels || {}
      );

      await this.handleConfigHotReload(nextConfig, mcpChanged, channelsChanged);
    });
  }

  private static async handleConfigHotReload(
    nextConfig: typeof configManager.config,
    mcpChanged: boolean,
    channelsChanged: boolean
  ): Promise<void> {
    if (mcpChanged) {
      await this.reloadMcpServers(nextConfig);
    }

    if (channelsChanged) {
      await this.reloadChannelPlugins(nextConfig);
    }
  }

  private static async reloadMcpServers(nextConfig: typeof configManager.config): Promise<void> {
    if (!this.mcpHotReloadEnabled || !this.mcpManager) {
      return;
    }

    logger.info({}, 'MCP config changed, reconnecting MCP servers');
    await this.mcpManager.shutdown();
    await this.mcpManager.connectConfiguredServers(nextConfig.mcp?.servers || []);
  }

  private static async reloadChannelPlugins(nextConfig: typeof configManager.config): Promise<void> {
    if (!this.channelHotReloadEnabled) {
      return;
    }

    logger.info({}, 'Channel config changed, reloading channel plugins');
    await channelManager.shutdown();
    await this.loadChannelPlugins(nextConfig.channels || {});

    const previousHotReloadState = this.channelHotReloadEnabled;
    this.channelHotReloadEnabled = false;
    try {
      await configManager.syncAllDefaultConfigs();
    } finally {
      this.channelHotReloadEnabled = previousHotReloadState;
    }
  }

  private static hasSerializedConfigChanged(previousValue: unknown, nextValue: unknown): boolean {
    return JSON.stringify(previousValue) !== JSON.stringify(nextValue);
  }

  static async shutdown(): Promise<void> {
    logger.info({}, 'Shutting down AesyClaw...');

    this.disableConfigHotReload();
    await this.shutdownChannels();
    this.shutdownCron();
    await this.shutdownMcp();
    this.shutdownPlugins();
    this.shutdownDatabase();
    await this.shutdownSkills();
    await this.shutdownRoles();
    this.shutdownSessionRegistry();
    await this.shutdownConfig();

    this.mcpManager = null;
    this.initialized = false;

    logger.info({}, 'AesyClaw shutdown completed');
  }

  private static disableConfigHotReload(): void {
    if (this.configChangeUnsubscribe) {
      this.configChangeUnsubscribe();
      this.configChangeUnsubscribe = null;
    }

    this.mcpHotReloadEnabled = false;
    this.channelHotReloadEnabled = false;
  }

  private static async shutdownChannels(): Promise<void> {
    try {
      await channelManager.shutdown();
      logger.info({}, '[1/9] Channel Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Channel Manager');
    }
  }

  private static shutdownCron(): void {
    try {
      cronJobScheduler.stop();
      logger.info({}, '[2/9] Cron scheduler stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Cron scheduler');
    }
  }

  private static async shutdownMcp(): Promise<void> {
    try {
      if (this.mcpManager) {
        await this.mcpManager.shutdown();
        logger.info({}, '[3/9] MCP Manager stopped');
      }
    } catch (error) {
      logger.error({ error }, 'Error stopping MCP Manager');
    }
  }

  private static shutdownPlugins(): void {
    try {
      pluginManager.shutdown();
      logger.info({}, '[4/9] Plugin Manager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping Plugin Manager');
    }
  }

  private static shutdownDatabase(): void {
    try {
      sqliteManager.close();
      logger.info({}, '[5/9] SQLiteManager closed');
    } catch (error) {
      logger.error({ error }, 'Error closing SQLiteManager');
    }
  }

  private static async shutdownSkills(): Promise<void> {
    try {
      const { skillManager } = await import('./features/skills/skill-manager.js');
      await skillManager.shutdown();
      logger.info({}, '[6/9] SkillManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping SkillManager');
    }
  }

  private static async shutdownRoles(): Promise<void> {
    try {
      const { roleManager } = await import('./features/roles/role-manager.js');
      roleManager.shutdown();
      logger.info({}, '[7/9] RoleManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping RoleManager');
    }
  }

  private static shutdownSessionRegistry(): void {
    try {
      shutdownSessionRuntime();
      logger.info({}, '[8/9] Session runtime stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping session runtime');
    }
  }

  private static async shutdownConfig(): Promise<void> {
    try {
      await configManager.destroy();
      logger.info({}, '[9/9] ConfigManager stopped');
    } catch (error) {
      logger.error({ error }, 'Error stopping ConfigManager');
    }
  }

  static isInitialized(): boolean {
    return this.initialized;
  }

  static async restart(options: BootstrapOptions = {}): Promise<void> {
    await this.shutdown();
    await this.initialize(options);
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
    const toolStats = sharedToolRegistry.getStats();
    const mcpServers = this.mcpManager?.getConnectedServers() || [];
    const plugins = pluginManager?.getLoadedPlugins() || [];
    const roleStats = roleManager.isInitialized() ? { total: roleManager.getAllRoles().length } : { total: 0 };
    const sessionTotal = sqliteManager.isInitialized() ? sessionRepository.findAll().length : 0;

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
      sessions: { total: sessionTotal },
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
