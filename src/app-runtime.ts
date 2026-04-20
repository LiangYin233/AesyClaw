import { agentStage } from '@/agent/runtime/agent-message-stage.js';
import { AgentCronExecutor } from '@/agent/runtime/cron-executor.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import {
  createSessionStage,
  getRoleInfoForCommandContext,
  switchRoleForCommandContext,
} from '@/agent/session/session-runtime.js';
import { ChatService } from '@/agent/session/session-service.js';
import { createSubAgentTools } from '@/agent/subagent/subagent-tools.js';
import { ChannelRuntime } from '@/channels/channel-runtime.js';
import { ChannelPluginManager } from '@/channels/channel-manager.js';
import type { CommandDefinition } from '@/contracts/commands.js';
import { createCommandMiddleware } from '@/features/commands/command-middleware.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { createHelpCommandGroup } from '@/features/commands/help-command-group.js';
import { createSessionCommandGroup } from '@/features/commands/session-command-group.js';
import { createConfigStage } from '@/features/config/config-message-stage.js';
import { cronTools } from '@/features/cron/cron-tools.js';
import { createPluginCommandGroup } from '@/features/plugins/plugin-command-group.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';
import { createRoleCommandGroup } from '@/features/roles/role-command-group.js';
import { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { logger } from '@/platform/observability/logger.js';
import { createRegistrationOwner } from '@/platform/registration/types.js';
import { McpRuntime } from '@/platform/tools/mcp/mcp-runtime.js';
import { createMultimodalTools } from '@/platform/tools/multimodal-tools.js';
import { ToolManager } from '@/platform/tools/registry.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type {
  ChatSessionStore,
  ConfigManagerService,
  CronServiceRuntime,
  PathResolverService,
  RoleManagerService,
  SkillManagerService,
  SQLiteManagerService,
} from '@/runtime-dependencies.js';

interface AppRuntimeDependencies {
  toolManager: ToolManager;
  commandManager: CommandManager;
  systemPromptManager: SystemPromptManager;
  pluginManager: PluginManager;
  chatService: ChatService;
  channelManager: ChannelPluginManager;
  pathResolver: PathResolverService;
  configManager: ConfigManagerService;
  sqliteManager: SQLiteManagerService;
  roleManager: RoleManagerService;
  skillManager: SkillManagerService;
  cronService: CronServiceRuntime;
  chatStore: Pick<ChatSessionStore, 'count'>;
}

type DisposableRegistrationScope = {
  dispose(): void;
};

export class AppRuntime {
  private pipeline: ChannelPipeline | null = null;
  private initialized = false;
  private systemRegistrationScopes: DisposableRegistrationScope[] = [];

  private readonly toolManager: ToolManager;
  private readonly commandManager: CommandManager;
  private readonly systemPromptManager: SystemPromptManager;
  private readonly pluginManager: PluginManager;
  private readonly chatService: ChatService;
  private readonly channelManager: ChannelPluginManager;
  private readonly channelRuntime: ChannelRuntime;
  private readonly mcpRuntime: McpRuntime;
  private readonly deps: AppRuntimeDependencies;

  constructor(deps: AppRuntimeDependencies) {
    this.deps = deps;
    this.toolManager = deps.toolManager;
    this.commandManager = deps.commandManager;
    this.systemPromptManager = deps.systemPromptManager;
    this.pluginManager = deps.pluginManager;
    this.chatService = deps.chatService;
    this.channelManager = deps.channelManager;
    this.channelRuntime = new ChannelRuntime({
      channelManager: this.channelManager,
      configSource: {
        getChannelsConfig: () => {
          if (!this.deps.configManager.isInitialized()) return {};
          return this.deps.configManager.config?.channels || {};
        },
        onChannelsConfigChange: listener => this.deps.configManager.onConfigChange(async (nextConfig, previousConfig) => {
          const nextChannels = nextConfig.channels || {};
          const previousChannels = previousConfig.channels || {};
          if (!hasCanonicalValueChanged(previousChannels, nextChannels)) {
            return;
          }
          await listener(nextChannels, previousChannels);
        }),
        syncDefaultConfigs: () => this.deps.configManager.syncAllDefaultConfigs(),
      },
      getPipeline: () => this.pipeline,
    });
    this.mcpRuntime = new McpRuntime({
      toolManager: this.toolManager,
      configSource: {
        getServerConfigs: () => {
          if (!this.deps.configManager.isInitialized()) return [];
          return this.deps.configManager.config?.mcp?.servers || [];
        },
        onServerConfigChange: listener => this.deps.configManager.onConfigChange(async (nextConfig, previousConfig) => {
          const nextServers = nextConfig.mcp?.servers || [];
          const previousServers = previousConfig.mcp?.servers || [];
          if (!hasCanonicalValueChanged(previousServers, nextServers)) {
            return;
          }
          await listener(nextServers, previousServers);
        }),
      },
    });
  }

  async start(): Promise<void> {
    if (this.initialized) {
      logger.warn({}, 'Bootstrap already initialized, skipping...');
      return;
    }

    try {
      logger.info({}, 'AesyClaw starting...');
      await this.runInitStages();
      this.initialized = true;
      logger.info({}, 'AesyClaw started successfully');
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ error: errorMessage, stack: errorStack }, 'Bootstrap failed');

      try {
        await this.stop();
      } catch (cleanupError) {
        logger.error({ error: cleanupError }, 'Bootstrap cleanup failed');
      }

      throw error;
    }
  }

  async stop(): Promise<void> {
    logger.info({}, 'Shutting down AesyClaw...');

    const steps: Array<[string, () => void | Promise<void>]> = [
      ['Channel runtime', () => this.channelRuntime.stop()],
      ['Cron scheduler', () => this.deps.cronService.stop()],
      ['MCP runtime', () => this.mcpRuntime.stop()],
      ['Plugin Manager', () => this.pluginManager.shutdown()],
      ['System registrations', () => this.disposeSystemScopes()],
      ['SQLiteManager', () => this.deps.sqliteManager.close()],
      ['SkillManager', () => this.deps.skillManager.shutdown()],
      ['RoleManager', () => this.deps.roleManager.shutdown()],
      ['ConfigManager', () => this.deps.configManager.destroy()],
    ];

    for (const [i, [label, fn]] of steps.entries()) {
      try {
        await fn();
        logger.info({}, `[${i + 1}/${steps.length}] ${label} stopped`);
      } catch (error) {
        logger.error({ error }, `Error stopping ${label}`);
      }
    }

    this.pipeline = null;
    this.initialized = false;

    logger.info({}, 'AesyClaw shutdown completed');
  }

  getStatus() {
    const mcpServers = this.mcpRuntime.getConnectedServers();

    return {
      initialized: this.initialized,
      pathResolver: this.deps.pathResolver.isInitialized(),
      configManager: this.deps.configManager.isInitialized(),
      sqliteManager: this.deps.sqliteManager.isInitialized(),
      toolRegistry: { totalTools: this.toolManager.getStats().totalTools },
      roles: {
        total: this.deps.roleManager.isInitialized() ? this.deps.roleManager.getAllRoles().length : 0,
      },
      sessions: {
        total: this.deps.sqliteManager.isInitialized() ? this.deps.chatStore.count() : 0,
      },
      mcpServers: mcpServers.filter(server => server.connected).length,
      plugins: this.pluginManager.getLoadedPlugins().length,
      channels: this.channelRuntime.getChannelCount(),
      cron: {
        running: this.deps.cronService.isRunning(),
        scheduledTasks: this.deps.cronService.getScheduledTaskCount(),
      },
    };
  }

  private buildSystemCommands(): CommandDefinition[] {
    return [
      ...createHelpCommandGroup(this.commandManager),
      ...createPluginCommandGroup({
        getPluginCommands: () => this.commandManager.getPluginCommands(),
        enablePlugin: pluginName => this.pluginManager.enablePlugin(pluginName),
        disablePlugin: pluginName => this.pluginManager.disablePlugin(pluginName),
      }),
      ...createSessionCommandGroup(this.chatService),
      ...createRoleCommandGroup({
        getSessionForCommand: ctx => ({
          switchRole: roleId => switchRoleForCommandContext(this.chatService, ctx, roleId),
          getRoleInfo: () => getRoleInfoForCommandContext(this.chatService, ctx),
        }),
        toolCatalog: this.toolManager,
      }),
    ];
  }

  private trackSystemScope<T extends DisposableRegistrationScope>(scope: T): T {
    this.systemRegistrationScopes.push(scope);
    return scope;
  }

  private disposeSystemScopes(): void {
    const scopes = this.systemRegistrationScopes.reverse();
    this.systemRegistrationScopes = [];

    for (const scope of scopes) {
      try {
        scope.dispose();
      } catch (error) {
        logger.error({ error }, 'Failed to dispose system registration scope');
      }
    }
  }

  private registerSystemCommands(): void {
    const systemScope = this.trackSystemScope(
      this.commandManager.createScope(createRegistrationOwner('system', 'bootstrap'))
    );
    const systemCommands = this.buildSystemCommands();
    systemScope.registerMany(systemCommands);
    logger.info({ count: systemCommands.length }, '系统命令已注册');
  }

  private async runInitStages(): Promise<void> {
    const multimodalTools = createMultimodalTools(() => this.deps.configManager.config);

    await this.deps.pathResolver.initialize();
    await this.deps.configManager.initialize();
    this.deps.sqliteManager.initialize();

    this.pipeline = new ChannelPipeline(this.pluginManager);

    await this.deps.skillManager.initialize();
    logger.info(this.deps.skillManager.getStats(), 'Skills system loaded');

    await this.deps.roleManager.initialize();
    logger.info({ roleCount: this.deps.roleManager.getAllRoles().length }, 'Role system loaded');

    const subAgentTools = createSubAgentTools({
      toolCatalog: this.toolManager,
      hookRuntime: this.pluginManager,
      configSource: {
        getConfig: () => this.deps.configManager.config,
      },
      roleStore: this.deps.roleManager,
      skillStore: this.deps.skillManager,
    });
    const subAgentScope = this.trackSystemScope(
      this.toolManager.createScope(createRegistrationOwner('system', 'subagent-tools'))
    );
    for (const tool of subAgentTools) {
      subAgentScope.register(tool);
    }
    logger.info({ toolCount: subAgentTools.length }, 'SubAgent tools registered');

    const multimodalScope = this.trackSystemScope(
      this.toolManager.createScope(createRegistrationOwner('system', 'multimodal-tools'))
    );
    multimodalScope.register(multimodalTools.speechToTextTool);
    multimodalScope.register(multimodalTools.imageUnderstandingTool);
    multimodalScope.register(multimodalTools.sendMsgTool);

    const cronScope = this.trackSystemScope(
      this.toolManager.createScope(createRegistrationOwner('system', 'cron-tools'))
    );
    for (const tool of cronTools) {
      cronScope.register(tool);
    }
    logger.info({ toolCount: cronTools.length }, 'Cron tools registered');

    this.pipeline.use(createConfigStage({
      isInitialized: () => this.deps.configManager.isInitialized(),
      initialize: () => this.deps.configManager.initialize(),
      getConfig: () => this.deps.configManager.config,
    }));
    this.registerSystemCommands();
    this.pipeline.use(createSessionStage(this.chatService));
    this.pipeline.use(createCommandMiddleware(this.commandManager));
    this.pipeline.use(agentStage);

    await this.pluginManager.initialize();
    await this.pluginManager.scanAndLoad(this.deps.configManager.config?.plugins || []);
    logger.info({ loadedPlugins: this.pluginManager.getPluginCount() }, 'Plugins system loaded');

    this.deps.cronService.setExecutor(new AgentCronExecutor({
      systemPromptManager: this.systemPromptManager,
      toolCatalog: this.toolManager,
      hookRuntime: this.pluginManager,
      configSource: {
        getConfig: () => this.deps.configManager.config,
      },
      roleStore: this.deps.roleManager,
      skillStore: this.deps.skillManager,
    }));
    this.deps.cronService.start();
    logger.info({ schedulerRunning: this.deps.cronService.isRunning() }, 'Cron system initialized');

    await this.mcpRuntime.start();
    await this.channelRuntime.start();
    
    await this.deps.configManager.syncAllDefaultConfigs();
    this.mcpRuntime.watchConfigChanges();
    this.channelRuntime.watchConfigChanges();
  }
}
