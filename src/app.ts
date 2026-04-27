/** Application — the main orchestrator that owns all subsystem manager instances. */

import { mkdirSync } from 'node:fs';
import { AgentEngine } from './agent/agent-engine';
import { LlmAdapter } from './agent/llm-adapter';
import { SessionManager } from './agent/session-manager';
import { ChannelManager } from './channel/channel-manager';
import { CommandRegistry } from './command/command-registry';
import { registerBuiltinCommands } from './command/builtin';
import { ConfigManager } from './core/config/config-manager';
import { DEFAULT_CONFIG } from './core/config/defaults';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger, setLogLevel } from './core/logger';
import { PathResolver } from './core/path-resolver';
import type { Unsubscribe } from './core/types';
import { CronManager } from './cron/cron-manager';
import { McpManager } from './mcp/mcp-manager';
import { SdkMcpClientFactory } from './mcp/sdk-mcp-client';
import { Pipeline } from './pipeline/pipeline';
import { PluginLoader } from './plugin/plugin-loader';
import { PluginManager } from './plugin/plugin-manager';
import { ensureDefaultRoleFile } from './role/default-role';
import { RoleManager } from './role/role-manager';
import { SkillManager } from './skill/skill-manager';
import { ToolRegistry } from './tool/tool-registry';
import { registerBuiltinTools } from './tool/builtin';

const logger = createScopedLogger('app');

export class Application {
  private pathResolver: PathResolver;
  private configManager: ConfigManager;
  private databaseManager: DatabaseManager;
  private skillManager: SkillManager;
  private roleManager: RoleManager;
  private toolRegistry: ToolRegistry;
  private commandRegistry: CommandRegistry;
  private llmAdapter: LlmAdapter;
  private agentEngine: AgentEngine;
  private sessionManager: SessionManager;
  private pipeline: Pipeline;
  private pluginManager: PluginManager | null = null;
  private cronManager: CronManager;
  private mcpManager: McpManager;
  private channelManager: ChannelManager;
  private unsubscribers: Unsubscribe[] = [];
  private started = false;

  constructor() {
    this.pathResolver = new PathResolver();
    this.configManager = new ConfigManager();
    this.databaseManager = new DatabaseManager();
    this.skillManager = new SkillManager();
    this.roleManager = new RoleManager();
    this.toolRegistry = new ToolRegistry();
    this.commandRegistry = new CommandRegistry();
    this.llmAdapter = new LlmAdapter();
    this.agentEngine = new AgentEngine();
    this.sessionManager = new SessionManager();
    this.pipeline = new Pipeline();
    this.cronManager = new CronManager();
    this.mcpManager = new McpManager();
    this.channelManager = new ChannelManager();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('Application already started');
      return;
    }

    logger.info('Starting AesyClaw...');

    await this.startStep('Path resolution', async () => {
      const root = process.cwd();
      this.pathResolver.resolve(root);
      logger.info('Path resolution complete', { root });
    });

    await this.startStep('Runtime directory preparation', async () => {
      const runtimeDirs = [
        this.pathResolver.runtimeRoot,
        this.pathResolver.dataDir,
        this.pathResolver.rolesDir,
        this.pathResolver.mediaDir,
        this.pathResolver.workspaceDir,
        this.pathResolver.userSkillsDir,
      ];

      for (const runtimeDir of runtimeDirs) {
        mkdirSync(runtimeDir, { recursive: true });
      }

      ensureDefaultRoleFile(this.pathResolver.rolesDir);
    });

    await this.startStep('Config loading', async () => {
      await this.configManager.load(this.pathResolver.configFile);
      setLogLevel(this.configManager.getConfig().server.logLevel);
      logger.info('Configuration loaded');
    });

    await this.startStep('Database initialization', async () => {
      await this.databaseManager.initialize(this.pathResolver.dbFile);
    });

    await this.startStep('Skill loading', async () => {
      await this.skillManager.loadAll(
        this.pathResolver.skillsDir,
        this.pathResolver.userSkillsDir,
      );
    });

    await this.startStep('Role loading', async () => {
      await this.roleManager.loadAll(this.pathResolver.rolesDir);
    });

    await this.startStep('LLM adapter initialization', async () => {
      this.llmAdapter.initialize({ configManager: this.configManager });
    });

    await this.startStep('Agent engine initialization', async () => {
      this.agentEngine.initialize({
        configManager: this.configManager,
        toolRegistry: this.toolRegistry,
        roleManager: this.roleManager,
        skillManager: this.skillManager,
        hookDispatcher: this.pipeline.getHookDispatcher(),
        llmAdapter: this.llmAdapter,
      });
    });

    await this.startStep('Session manager initialization', async () => {
      this.sessionManager.initialize({
        databaseManager: this.databaseManager,
        roleManager: this.roleManager,
        agentEngine: this.agentEngine,
        configManager: this.configManager,
        llmAdapter: this.llmAdapter,
      });
    });

    await this.startStep('Plugin manager initialization', async () => {
      this.pluginManager = new PluginManager({
        configManager: this.configManager,
        toolRegistry: this.toolRegistry,
        commandRegistry: this.commandRegistry,
        hookDispatcher: this.pipeline.getHookDispatcher(),
        channelManager: this.channelManager,
        pluginLoader: new PluginLoader({ extensionsDir: this.pathResolver.extensionsDir }),
      });
    });

    await this.startStep('Pipeline initialization', async () => {
      this.pipeline.initialize({
        sessionManager: this.sessionManager,
        agentEngine: this.agentEngine,
        commandRegistry: this.commandRegistry,
      });
    });

    await this.startStep('Built-in registration', async () => {
      registerBuiltinTools(this.toolRegistry, {
        cronManager: this.cronManager,
        agentEngine: this.agentEngine,
        roleManager: this.roleManager,
        llmAdapter: this.llmAdapter,
        configManager: this.configManager,
        skillManager: this.skillManager,
      });
      registerBuiltinCommands(this.commandRegistry, {
        roleManager: this.roleManager,
        pluginManager: this.getPluginManager(),
        sessionManager: this.sessionManager,
      });
    });

    await this.startStep('Plugin loading', async () => {
      await this.getPluginManager().loadAll();
    });

    await this.startStep('MCP manager initialization', async () => {
      this.mcpManager.initialize({
        configManager: this.configManager,
        toolRegistry: this.toolRegistry,
        clientFactory: new SdkMcpClientFactory(),
      });

      // Auto-write MCP example config entry if none configured
      const mcpConfig = this.configManager.get('mcp');
      if (mcpConfig.length === 0) {
        await this.configManager.update({ mcp: DEFAULT_CONFIG.mcp });
      }

      await this.mcpManager.connectAll();
    });

    await this.startStep('Channel manager initialization', async () => {
      this.channelManager.initialize({
        configManager: this.configManager,
        pipeline: this.pipeline,
      });
      await this.channelManager.startAll();
    });

    await this.startStep('Cron manager initialization', async () => {
      await this.cronManager.initialize({
        databaseManager: this.databaseManager,
        pipeline: this.pipeline,
        send: async (sessionKey, message) => this.channelManager.send(sessionKey, message),
      });
    });

    await this.startStep('Config synchronization', async () => {
      await this.configManager.syncDefaults();
      this.installConfigSubscriptions();
    });

    await this.startStep('Hot reload startup', async () => {
      this.configManager.startHotReload();
      this.roleManager.startWatching();
    });

    this.started = true;
    logger.info('AesyClaw started successfully');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down AesyClaw...');

    const steps: Array<() => Promise<void> | void> = [
      () => this.configManager.stopHotReload(),
      () => this.roleManager.stopWatching(),
      () => this.clearConfigSubscriptions(),
      () => this.channelManager.stopAll(),
      () => this.mcpManager.disconnectAll(),
      () => this.cronManager.destroy(),
      () => this.pluginManager?.unloadAll(),
      () => this.pipeline.destroy(),
      () => this.databaseManager.close(),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        logger.error('Shutdown step failed', err);
      }
    }

    this.started = false;
    logger.info('AesyClaw shutdown complete');
  }

  private async startStep(name: string, step: () => Promise<void> | void): Promise<void> {
    try {
      await step();
    } catch (err) {
      logger.error(`${name} failed`, err);
      await this.shutdown();
      throw err;
    }
  }

  private installConfigSubscriptions(): void {
    this.clearConfigSubscriptions();
    this.unsubscribers.push(
      this.configManager.subscribe('server', (server) => {
        setLogLevel(server.logLevel);
      }),
      this.configManager.subscribe('plugins', async () => {
        await this.pluginManager?.handleConfigReload();
      }),
      this.configManager.subscribe('mcp', async () => {
        await this.mcpManager.handleConfigReload();
      }),
      this.configManager.subscribe('channels', async () => {
        await this.channelManager.handleConfigReload();
      }),
      this.roleManager.subscribeChanges(() => {
        this.sessionManager.clearCachedSessions();
      }),
    );
  }

  private clearConfigSubscriptions(): void {
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      try {
        unsubscribe();
      } catch (err) {
        logger.error('Config unsubscribe failed', err);
      }
    }
  }

  private getPluginManager(): PluginManager {
    if (!this.pluginManager) {
      throw new Error('PluginManager not initialized');
    }
    return this.pluginManager;
  }
}
