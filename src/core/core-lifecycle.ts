/** CoreLifecycle — 核心生命周期协调器，负责启动序列和关闭。 */

import type { LlmAdapter } from '@aesyclaw/agent/llm-adapter';

import type { SessionManager } from '@aesyclaw/session';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import { registerBuiltinCommands } from '@aesyclaw/command/builtin';
import type { ConfigManager } from './config/config-manager';
import { DEFAULT_CONFIG } from './config/defaults';
import type { DatabaseManager } from './database/database-manager';
import { createScopedLogger, setLogLevel } from './logger';
import type { ResolvedPaths } from './path-resolver';
import type { CronManager } from '@aesyclaw/cron/cron-manager';
import type { McpManager } from '@aesyclaw/mcp/mcp-manager';
import type { Pipeline } from '@aesyclaw/pipeline/pipeline';
import { ExtensionManager } from '@aesyclaw/extension/extension-manager';
import type { RoleManager } from '@aesyclaw/role/role-manager';
import type { SkillManager } from '@aesyclaw/skill/skill-manager';
import type { ToolRegistry } from '@aesyclaw/tool/tool-registry';
import { registerBuiltinTools } from '@aesyclaw/tool/builtin';
import type { WebUiManager } from '@aesyclaw/web/webui-manager';

const logger = createScopedLogger('core-lifecycle');

export type CoreLifecycleDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  skillManager: SkillManager;
  roleManager: RoleManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  llmAdapter: LlmAdapter;
  sessionManager: SessionManager;
  pipeline: Pipeline;
  cronManager: CronManager;
  mcpManager: McpManager;
  webUiManager: WebUiManager;
};

export class CoreLifecycle {
  private readonly deps: CoreLifecycleDependencies;
  private extensionManager: ExtensionManager | null = null;
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

  async start(): Promise<void> {
    logger.info('正在启动 AesyClaw...');

    await this.runStartupSequence();

    logger.info('AesyClaw 启动成功');
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    logger.info('正在关闭 AesyClaw...');

    const steps: Array<() => Promise<void> | void> = [
      () => this.resolvedDeps.configManager.stopHotReload(),
      () => this.resolvedDeps.webUiManager.destroy(),
      () => this.resolvedDeps.cronManager.destroy(),
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

  // ─── 启动序列 ───────────────────────────────────────────────

  private async runStartupSequence(): Promise<void> {
    await this.runStep('初始化核心管理器', async () => await this.initCoreManagers());
    await this.runStep('初始化扩展运行时', async () => await this.initExtensionRuntime());
    await this.runStep('初始化外围运行时', async () => await this.initPeripheralRuntime());
    await this.runStep('安装运行时热重载', async () => await this.installHotReload());
  }

  // ─── 启动步骤 ───────────────────────────────────────────────

  private async initCoreManagers(): Promise<void> {
    setLogLevel(this.resolvedDeps.configManager.get('server.logLevel') as string);
    await this.resolvedDeps.databaseManager.initialize(this.paths.dbFile);
    await this.resolvedDeps.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);
    await this.resolvedDeps.roleManager.initialize();
  }

  private async initExtensionRuntime(): Promise<void> {
    await this.resolvedDeps.pipeline.initialize({
      sessionManager: this.resolvedDeps.sessionManager,
      commandRegistry: this.resolvedDeps.commandRegistry,
      roleManager: this.resolvedDeps.roleManager,
      databaseManager: this.resolvedDeps.databaseManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
      skillManager: this.resolvedDeps.skillManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      compressionThreshold: this.resolvedDeps.configManager.get(
        'agent.memory.compressionThreshold',
      ) as number,
    });

    this.extensionManager = new ExtensionManager({
      configManager: this.resolvedDeps.configManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      commandRegistry: this.resolvedDeps.commandRegistry,
      hookRegistry: this.resolvedDeps.pipeline.hooks,
      pipeline: this.resolvedDeps.pipeline,
      extensionsDir: this.paths.extensionsDir,
    });

    registerBuiltinTools(this.resolvedDeps.toolRegistry, {
      cronManager: this.resolvedDeps.cronManager,
      roleManager: this.resolvedDeps.roleManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
      configManager: this.resolvedDeps.configManager,
      skillManager: this.resolvedDeps.skillManager,
      usageRepository: this.resolvedDeps.databaseManager.usage,
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
    });

    await this.extensionManager.setup();
  }

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
    await this.resolvedDeps.cronManager.initialize({
      databaseManager: this.resolvedDeps.databaseManager,
      pipeline: this.resolvedDeps.pipeline,
      sessionManager: this.resolvedDeps.sessionManager,
      send: async (sessionKey, message) => await em.channels.send(sessionKey, message),
    });

    await this.resolvedDeps.webUiManager.initialize({
      configManager: this.resolvedDeps.configManager,
      databaseManager: this.resolvedDeps.databaseManager,
      sessionManager: this.resolvedDeps.sessionManager,
      cronManager: this.resolvedDeps.cronManager,
      roleManager: this.resolvedDeps.roleManager,
      channelManager: em.channels,
      pluginManager: em,
      toolRegistry: this.resolvedDeps.toolRegistry,
      skillManager: this.resolvedDeps.skillManager,
    });
  }

  private async installHotReload(): Promise<void> {
    await this.resolvedDeps.configManager.syncDefaults();
    this.resolvedDeps.configManager.startHotReload();
  }

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
