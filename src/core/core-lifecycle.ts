import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';

import type { SessionManager } from '@aesyclaw/session';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { registerBuiltinCommands } from '@aesyclaw/command/builtin';
import type { ConfigManager } from './config/config-manager';
import { DEFAULT_CONFIG } from './config/defaults';
import type { DatabaseManager } from './database/database-manager';
import { createScopedLogger, setLogLevel } from './logger';
import type { ResolvedPaths } from './path-resolver';
import { CronManager } from '@aesyclaw/cron/cron-manager';
import type { McpManager } from '@aesyclaw/mcp/mcp-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { RoleStore } from '@aesyclaw/role/role-store';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import { registerBuiltinTools } from '@aesyclaw/tool/builtin';
import { WebUiManager } from '@aesyclaw/web/webui-manager';
import type { AgentRegistry } from '@aesyclaw/agent/agent-registry';

const logger = createScopedLogger('core-lifecycle');

/** 核心生命周期所依赖的所有子系统管理器 */
export type CoreLifecycleDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  roleStore: RoleStore;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  llmAdapter: LlmAdapter;
  sessionManager: SessionManager;
  pipeline: Pipeline;
  mcpManager: McpManager;
  agentRegistry: AgentRegistry;
};

/** 核心生命周期管理器 — 协调所有子系统的启动与关闭顺序 */
export class CoreLifecycle {
  private readonly deps: CoreLifecycleDependencies;
  private extensionManager: ExtensionManager | null = null;
  private webUiManager: WebUiManager | null = null;
  private cronManager: CronManager | null = null;
  private shuttingDown = false;

  constructor(deps: CoreLifecycleDependencies) {
    this.deps = deps;
  }

  private get resolvedDeps(): CoreLifecycleDependencies {
    return this.deps;
  }

  private get paths(): Readonly<ResolvedPaths> {
    return this.deps.configManager.resolvedPaths;
  }

  /**
   * 按序启动所有子系统。任何步骤失败都会触发停止流程。
   */
  async start(): Promise<void> {
    logger.info('正在启动 AesyClaw...');

    await this.runStartupSequence();

    logger.info('AesyClaw 启动成功');
  }

  /**
   * 按逆序关闭所有子系统。支持幂等调用，重复调用不会重复关闭。
   */
  async stop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    logger.info('正在关闭 AesyClaw...');

    const steps: Array<() => Promise<void> | void> = [
      () => this.resolvedDeps.configManager.stopHotReload(),
      () => this.resolvedDeps.roleStore.stopHotReload(),
      () => this.webUiManager?.destroy(),
      () => this.cronManager?.destroy(),
      () => this.resolvedDeps.roleManager.destroy(),
      () => this.extensionManager?.destroy(),
      () => this.resolvedDeps.mcpManager.disconnectAll(),
      () => this.resolvedDeps.pipeline.destroy(),
      () => this.resolvedDeps.databaseManager.destroy(),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        logger.error('关闭步骤失败', err);
      }
    }

    logger.info('AesyClaw 关闭完成');
  }

  /**
   * 执行启动序列：核心管理器 → 扩展运行时 → 外围运行时 → 热重载。
   */
  private async runStartupSequence(): Promise<void> {
    await this.runStep('初始化核心管理器', async () => await this.initCoreManagers());
    await this.runStep('初始化扩展运行时', async () => await this.initExtensionRuntime());
    await this.runStep('初始化外围运行时', async () => await this.initPeripheralRuntime());
    await this.runStep('安装运行时热重载', async () => await this.installHotReload());
  }

  /** 初始化日志级别、数据库、技能和角色管理器 */
  private async initCoreManagers(): Promise<void> {
    setLogLevel(this.resolvedDeps.configManager.get('server.logLevel') as string);
    await this.resolvedDeps.databaseManager.initialize(this.paths.dbFile);
    await this.resolvedDeps.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);
    await this.resolvedDeps.roleManager.initialize();
  }

  /** 初始化管道、扩展管理器和内置命令注册 */
  private async initExtensionRuntime(): Promise<void> {
    await this.resolvedDeps.pipeline.initialize();

    this.extensionManager = new ExtensionManager({
      configManager: this.resolvedDeps.configManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      commandRegistry: this.resolvedDeps.commandRegistry,
      hookRegistry: this.resolvedDeps.pipeline.hooks,
      pipeline: this.resolvedDeps.pipeline,
      paths: this.paths,
    });

    registerBuiltinCommands(this.resolvedDeps.commandRegistry, {
      roleManager: this.resolvedDeps.roleManager,
      pluginManager: this.extensionManager,
      sessionManager: this.resolvedDeps.sessionManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
      skillManager: this.resolvedDeps.skillManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      hookDispatcher: this.resolvedDeps.pipeline.hooks,
      databaseManager: this.resolvedDeps.databaseManager,
      compressionThreshold: this.resolvedDeps.configManager.get(
        'agent.memory.compressionThreshold',
      ) as number,
      agentRegistry: this.resolvedDeps.agentRegistry,
    });

    await this.extensionManager.setup();
  }

  /** 初始化 MCP、定时任务、内置工具和 Web UI */
  private async initPeripheralRuntime(): Promise<void> {
    const mcpConfig = this.resolvedDeps.configManager.get('mcp') as typeof DEFAULT_CONFIG.mcp;
    if (mcpConfig.length === 0) {
      await this.resolvedDeps.configManager.set('mcp', DEFAULT_CONFIG.mcp);
    }

    await this.resolvedDeps.mcpManager.connectAll();

    if (!this.extensionManager) {
      throw new Error('ExtensionManager 未初始化');
    }
    const em = this.extensionManager;
    const cronManager = new CronManager({
      databaseManager: this.resolvedDeps.databaseManager,
      pipeline: this.resolvedDeps.pipeline,
      sessionManager: this.resolvedDeps.sessionManager,
      send: async (sessionKey, message) => await em.channels.send(sessionKey, message),
    });
    await cronManager.initialize();

    this.cronManager = cronManager;

    registerBuiltinTools(this.resolvedDeps.toolRegistry, {
      cronManager: this.cronManager,
      roleManager: this.resolvedDeps.roleManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
      configManager: this.resolvedDeps.configManager,
      skillManager: this.resolvedDeps.skillManager,
      usageRepository: this.resolvedDeps.databaseManager.usage,
      agentRegistry: this.resolvedDeps.agentRegistry,
      sessionManager: this.resolvedDeps.sessionManager,
    });

    const webUiManager = new WebUiManager({
      configManager: this.resolvedDeps.configManager,
      databaseManager: this.resolvedDeps.databaseManager,
      sessionManager: this.resolvedDeps.sessionManager,
      cronManager: this.cronManager,
      roleManager: this.resolvedDeps.roleManager,
      channelManager: em.channels,
      pluginManager: em,
      toolRegistry: this.resolvedDeps.toolRegistry,
      skillManager: this.resolvedDeps.skillManager,
      paths: this.paths,
    });
    await webUiManager.initialize();

    this.webUiManager = webUiManager;
  }

  /** 同步默认配置并启动配置和角色存储的热重载 */
  private async installHotReload(): Promise<void> {
    await this.resolvedDeps.configManager.syncDefaults();
    this.resolvedDeps.configManager.startHotReload();
    this.resolvedDeps.roleStore.startHotReload();
  }

  /** 执行单个启动步骤，失败时自动调用 stop() 并抛出错误 */
  private async runStep(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
      logger.info(`✓ ${name}`);
    } catch (err) {
      logger.error(`启动步骤 "${name}" 失败`, err);
      await this.stop();
      throw err;
    }
  }
}
