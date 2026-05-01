/** Application — 主协调器，拥有所有子系统管理器实例。 */

import { mkdirSync } from 'node:fs';
import { AgentEngine } from './agent/agent-engine';
import { LlmAdapter } from './agent/llm-adapter';
import { PromptBuilder } from './agent/prompt-builder';
import { AgentRunPolicy } from './agent/agent-run-policy';
import { SessionManager } from './agent/session-manager';
import { ChannelManager } from './channel/channel-manager';
import { ChannelLoader } from './channel/channel-loader';
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
import { WebUiManager } from './web/webui-manager';

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
  private webUiManager: WebUiManager;
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
    await this.prepareRuntime();
    await this.loadRuntimeConfiguration();
    await this.initializeCoreManagers();
    await this.initializeAgentRuntime();
    await this.initializeExtensionRuntime();
    await this.initializeOuterRuntime();
    await this.installRuntimeReloading();
  }

  private async prepareRuntime(): Promise<void> {
    await this.startStep('路径解析', async () => {
      const root = process.cwd();
      this.pathResolver.resolve(root);
      logger.info('路径解析完成', { root });
    });

    await this.startStep('运行时目录准备', async () => {
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
  }

  private async loadRuntimeConfiguration(): Promise<void> {
    await this.startStep('配置加载', async () => {
      await this.configManager.load(this.pathResolver.configFile);
      setLogLevel(this.configManager.getConfig().server.logLevel);
      logger.info('配置已加载');
    });
  }

  private async initializeCoreManagers(): Promise<void> {
    await this.startStep('数据库初始化', async () => {
      await this.databaseManager.initialize(this.pathResolver.dbFile);
    });

    await this.startStep('技能加载', async () => {
      await this.skillManager.loadAll(this.pathResolver.skillsDir, this.pathResolver.userSkillsDir);
    });

    await this.startStep('角色加载', async () => {
      await this.roleManager.loadAll(this.pathResolver.rolesDir);
    });
  }

  private async initializeAgentRuntime(): Promise<void> {
    await this.startStep('LLM 适配器初始化', async () => {
      this.llmAdapter.initialize({ configManager: this.configManager });
    });

    await this.startStep('Agent 引擎初始化', async () => {
      const promptBuilder = new PromptBuilder({
        roleManager: this.roleManager,
        skillManager: this.skillManager,
        toolRegistry: this.toolRegistry,
        toolHookDispatcher: this.pipeline.getToolHookDispatcher(),
      });
      const runPolicy = new AgentRunPolicy({
        configManager: this.configManager,
        llmAdapter: this.llmAdapter,
      });
      this.agentEngine.initialize({
        llmAdapter: this.llmAdapter,
        promptBuilder,
        runPolicy,
      });
    });

    await this.startStep('会话管理器初始化', async () => {
      this.sessionManager.initialize({
        databaseManager: this.databaseManager,
        roleManager: this.roleManager,
        agentEngine: this.agentEngine,
        configManager: this.configManager,
        llmAdapter: this.llmAdapter,
      });
    });
  }

  private async initializeExtensionRuntime(): Promise<void> {
    await this.startStep('Pipeline 初始化', async () => {
      this.pipeline.initialize({
        sessionManager: this.sessionManager,
        agentEngine: this.agentEngine,
        commandRegistry: this.commandRegistry,
      });
    });

    await this.startStep('插件管理器初始化', async () => {
      this.pluginManager = new PluginManager({
        configManager: this.configManager,
        toolRegistry: this.toolRegistry,
        commandRegistry: this.commandRegistry,
        hookRegistry: this.pipeline,
        channelManager: this.channelManager,
        pluginLoader: new PluginLoader({ extensionsDir: this.pathResolver.extensionsDir }),
      });
    });

    await this.startStep('内置组件注册', async () => {
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
    });

    await this.startStep('插件加载', async () => {
      await this.getPluginManager().loadAll();
    });
  }

  private async initializeOuterRuntime(): Promise<void> {
    await this.startStep('MCP 管理器初始化', async () => {
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
    });

    await this.startStep('频道管理器初始化', async () => {
      this.channelManager.initialize({
        configManager: this.configManager,
        pipeline: this.pipeline,
      });
      await this.loadChannelExtensions();
      await this.channelManager.startAll();
    });

    await this.startStep('Cron 管理器初始化', async () => {
      await this.cronManager.initialize({
        databaseManager: this.databaseManager,
        pipeline: this.pipeline,
        send: async (sessionKey, message) => await this.channelManager.send(sessionKey, message),
      });
    });

    await this.startStep('WebUI 初始化', async () => {
      await this.webUiManager.initialize({
        configManager: this.configManager,
        databaseManager: this.databaseManager,
        sessionManager: this.sessionManager,
        cronManager: this.cronManager,
        roleManager: this.roleManager,
        channelManager: this.channelManager,
        pluginManager: this.getPluginManager(),
      });
    });
  }

  private async installRuntimeReloading(): Promise<void> {
    await this.startStep('配置同步', async () => {
      await this.configManager.syncDefaults();
      this.installConfigSubscriptions();
    });

    await this.startStep('热重载启动', async () => {
      this.configManager.startHotReload();
      this.roleManager.startWatching();
    });
  }

  async shutdown(): Promise<void> {
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

  private async startStep(name: string, step: () => Promise<void> | void): Promise<void> {
    try {
      await step();
    } catch (err) {
      logger.error(`${name} 失败`, err);
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

  private async loadChannelExtensions(): Promise<void> {
    const loader = new ChannelLoader({ extensionsDir: this.pathResolver.extensionsDir });
    const channelDirs = await loader.discover();
    for (const channelDir of channelDirs) {
      try {
        const module = await loader.load(channelDir);
        this.channelManager.register(module.definition);
      } catch (err) {
        logger.error(`频道扩展 "${channelDir}" 加载失败`, err);
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
