import { ChannelRuntime } from '@/channels/channel-runtime.js';
import { PluginRuntime } from '@/features/plugins/plugin-runtime.js';
import { logger } from '@/platform/observability/logger.js';
import { McpRuntime } from '@/platform/tools/mcp/mcp-runtime.js';
import { ToolManager } from '@/platform/tools/registry.js';
import type {
  ChatSessionStore,
  ConfigManagerService,
  PathResolverService,
  RoleManagerService,
  SkillManagerService,
  SQLiteManagerService,
} from '@/contracts/runtime-services.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { CronRuntime } from '@/runtime/cron-runtime.js';
import { PipelineRuntime } from '@/runtime/pipeline-runtime.js';
import { SystemRuntime } from '@/runtime/system-runtime.js';

interface AppRuntimeDependencies {
  toolManager: ToolManager;
  pluginRuntime: PluginRuntime;
  pipelineRuntime: PipelineRuntime;
  channelRuntime: ChannelRuntime;
  mcpRuntime: McpRuntime;
  cronRuntime: CronRuntime;
  systemRuntime: SystemRuntime;
  pathResolver: PathResolverService;
  configManager: ConfigManagerService;
  sqliteManager: SQLiteManagerService;
  roleManager: RoleManagerService;
  skillManager: SkillManagerService;
  chatStore: Pick<ChatSessionStore, 'count'>;
}

export class AppRuntime {
  private initialized = false;

  private readonly toolManager: ToolManager;
  private readonly pluginRuntime: PluginRuntime;
  private readonly pipelineRuntime: PipelineRuntime;
  private readonly channelRuntime: ChannelRuntime;
  private readonly mcpRuntime: McpRuntime;
  private readonly cronRuntime: CronRuntime;
  private readonly systemRuntime: SystemRuntime;
  private readonly deps: AppRuntimeDependencies;

  constructor(deps: AppRuntimeDependencies) {
    this.deps = deps;
    this.toolManager = deps.toolManager;
    this.pluginRuntime = deps.pluginRuntime;
    this.pipelineRuntime = deps.pipelineRuntime;
    this.channelRuntime = deps.channelRuntime;
    this.mcpRuntime = deps.mcpRuntime;
    this.cronRuntime = deps.cronRuntime;
    this.systemRuntime = deps.systemRuntime;
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
      ['Cron runtime', () => this.cronRuntime.stop()],
      ['MCP runtime', () => this.mcpRuntime.stop()],
      ['Plugin runtime', () => this.pluginRuntime.stop()],
      ['Pipeline runtime', () => this.pipelineRuntime.stop()],
      ['System registrations', () => this.systemRuntime.dispose()],
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
      plugins: this.pluginRuntime.getPluginCount(),
      channels: this.channelRuntime.getChannelCount(),
      cron: {
        running: this.cronRuntime.isRunning(),
        scheduledTasks: this.cronRuntime.getScheduledTaskCount(),
      },
    };
  }

  private async runInitStages(): Promise<void> {
    await this.initializeCoreInfrastructure();
    await this.initializeDomainServices();
    this.pipelineRuntime.start();
    this.systemRuntime.register();
    await this.pluginRuntime.start();
    this.cronRuntime.start();
    await this.startManagedRuntimes();
  }

  private async initializeCoreInfrastructure(): Promise<void> {
    await this.deps.pathResolver.initialize();
    await this.deps.configManager.initialize();
    this.deps.sqliteManager.initialize();
  }

  private async initializeDomainServices(): Promise<void> {
    await this.deps.skillManager.initialize();
    logger.info(this.deps.skillManager.getStats(), 'Skills system loaded');

    await this.deps.roleManager.initialize();
    logger.info({ roleCount: this.deps.roleManager.getAllRoles().length }, 'Role system loaded');
  }

  private async startManagedRuntimes(): Promise<void> {
    await this.mcpRuntime.start();
    await this.channelRuntime.start();

    await this.deps.configManager.syncAllDefaultConfigs();
    this.pluginRuntime.watchConfigChanges();
    this.mcpRuntime.watchConfigChanges();
    this.channelRuntime.watchConfigChanges();
  }
}
