/** Application — 主协调器，拥有所有子系统管理器实例。 */

import { mkdirSync } from 'node:fs';
import { AgentEngine } from './agent/agent-engine';
import { LlmAdapter } from './agent/llm-adapter';
import { PromptBuilder } from './agent/prompt-builder';
import { SessionManager } from './agent/session-manager';
import { ChannelManager } from './channel/channel-manager';
import { CommandRegistry } from './command/command-registry';
import { registerBuiltinCommands } from './command/builtin';
import { ConfigManager } from './core/config/config-manager';
import { DEFAULT_CONFIG } from './core/config/defaults';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger, setLogLevel } from './core/logger';
import { resolvePaths, type ResolvedPaths } from './core/path-resolver';
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
import { WebUiManager } from './web/webui-manager';

const logger = createScopedLogger('app');

export class Application {
  private _paths: ResolvedPaths | null = null;

  private get paths(): ResolvedPaths {
    if (!this._paths) throw new Error('Paths not resolved');
    return this._paths;
  }
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
  private webUiManager: WebUiManager;
  private unsubscribers: Unsubscribe[] = [];
  private started = false;
  private shuttingDown = false;

  constructor() {
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
    this.webUiManager = new WebUiManager();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('应用已启动');
      return;
    }

    logger.info('正在启动 AesyClaw...');

    await this.runStartupSequence();

    this.started = true;
    logger.info('AesyClaw 启动成功');
  }

  private async runStartupSequence(): Promise<void> {
    const startupSequence: Array<{ name: string; fn: () => Promise<void> }> = [
      {
        name: '准备运行时',
        fn: async () => {
          const root = process.cwd();
          this._paths = resolvePaths(root);
          logger.info('路径解析完成', { root });

          const runtimeDirs = [
            this.paths.runtimeRoot,
            this.paths.dataDir,
            this.paths.rolesDir,
            this.paths.mediaDir,
            this.paths.workspaceDir,
            this.paths.userSkillsDir,
          ];

          for (const runtimeDir of runtimeDirs) {
            mkdirSync(runtimeDir, { recursive: true });
          }

          ensureDefaultRoleFile(this.paths.rolesDir);
        },
      },
      {
        name: '加载运行时配置',
        fn: async () => {
          await this.configManager.load(this.paths.configFile);
          setLogLevel(this.configManager.getConfig().server.logLevel);
          logger.info('配置已加载');
        },
      },
      {
        name: '初始化核心管理器',
        fn: async () => {
          await this.databaseManager.initialize(this.paths.dbFile);

          await this.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);

          await this.roleManager.loadAll(this.paths.rolesDir);
        },
      },
      {
        name: '初始化 Agent 运行时',
        fn: async () => {
          this.llmAdapter.initialize({ configManager: this.configManager });

          const promptBuilder = new PromptBuilder({
            roleManager: this.roleManager,
            skillManager: this.skillManager,
            toolRegistry: this.toolRegistry,
            toolHookDispatcher: this.pipeline.hookDispatcher,
          });
          this.agentEngine.initialize({
            llmAdapter: this.llmAdapter,
            promptBuilder,
          });

          this.sessionManager.initialize({
            databaseManager: this.databaseManager,
            roleManager: this.roleManager,
            agentEngine: this.agentEngine,
            configManager: this.configManager,
            llmAdapter: this.llmAdapter,
          });
        },
      },
      {
        name: '初始化扩展运行时',
        fn: async () => {
          this.pipeline.initialize({
            sessionManager: this.sessionManager,
            agentEngine: this.agentEngine,
            commandRegistry: this.commandRegistry,
          });

          this.pluginManager = new PluginManager({
            configManager: this.configManager,
            toolRegistry: this.toolRegistry,
            commandRegistry: this.commandRegistry,
            hookRegistry: this.pipeline.hookDispatcher,
            channelManager: this.channelManager,
            pluginLoader: new PluginLoader({ extensionsDir: this.paths.extensionsDir }),
          });

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
            agentEngine: this.agentEngine,
          });

          await this.getPluginManager().loadAll();
        },
      },
      {
        name: '初始化外围运行时',
        fn: async () => {
          this.mcpManager.initialize({
            configManager: this.configManager,
            toolRegistry: this.toolRegistry,
            clientFactory: new SdkMcpClientFactory(),
          });

          // 如果没有配置 MCP，则自动写入示例配置项
          const mcpConfig = this.configManager.get('mcp');
          if (mcpConfig.length === 0) {
            await this.configManager.update({ mcp: DEFAULT_CONFIG.mcp });
          }

          await this.mcpManager.connectAll();

          this.channelManager.initialize({
            configManager: this.configManager,
            pipeline: this.pipeline,
          });
          await this.channelManager.registerFromDisk(this.paths.extensionsDir);
          await this.channelManager.startAll();

          await this.cronManager.initialize({
            databaseManager: this.databaseManager,
            pipeline: this.pipeline,
            send: async (sessionKey, message) => await this.channelManager.send(sessionKey, message),
          });

          await this.webUiManager.initialize({
            configManager: this.configManager,
            databaseManager: this.databaseManager,
            sessionManager: this.sessionManager,
            cronManager: this.cronManager,
            roleManager: this.roleManager,
            channelManager: this.channelManager,
            pluginManager: this.getPluginManager(),
            toolRegistry: this.toolRegistry,
            skillManager: this.skillManager,
          });
        },
      },
      {
        name: '安装运行时热重载',
        fn: async () => {
          await this.configManager.syncDefaults();
          this.installConfigSubscriptions();

          this.configManager.startHotReload();
          this.roleManager.startWatching();
        },
      },
    ];

    for (const step of startupSequence) {
      await this.startStep(step.name, step.fn);
    }
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    logger.info('正在关闭 AesyClaw...');

    const steps: Array<() => Promise<void> | void> = [
      () => this.configManager.stopHotReload(),
      () => this.roleManager.stopWatching(),
      () => this.clearConfigSubscriptions(),
      () => this.webUiManager.destroy(),
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
        logger.error('关闭步骤失败', err);
      }
    }

    this.started = false;
    logger.info('AesyClaw 关闭完成');
  }

  private async startStep(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      logger.info(`✓ ${name}`);
    } catch (err) {
      logger.error(`启动步骤 "${name}" 失败`, err);
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
        logger.error('配置取消订阅失败', err);
      }
    }
  }



  private getPluginManager(): PluginManager {
    if (!this.pluginManager) {
      throw new Error('PluginManager 未初始化');
    }
    return this.pluginManager;
  }
}
