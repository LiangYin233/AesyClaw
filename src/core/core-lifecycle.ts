/** CoreLifecycle — 核心生命周期协调器，负责启动序列和关闭。 */

import { mkdirSync } from 'node:fs';
import type { AgentEngine } from '../agent/agent-engine';
import type { LlmAdapter } from '../agent/llm-adapter';
import { PromptBuilder } from '../agent/prompt-builder';
import type { SessionManager } from '../agent/session-manager';
import type { CommandRegistry } from '../command/command-registry';
import { registerBuiltinCommands } from '../command/builtin';
import type { ConfigManager } from './config/config-manager';
import { DEFAULT_CONFIG } from './config/defaults';
import type { DatabaseManager } from './database/database-manager';
import { createScopedLogger, setLogLevel } from './logger';
import { resolvePaths, type ResolvedPaths } from './path-resolver';
import type { Unsubscribe } from './types';
import type { CronManager } from '../cron/cron-manager';
import type { McpManager } from '../mcp/mcp-manager';
import { SdkMcpClientFactory } from '../mcp/sdk-mcp-client';
import type { Pipeline } from '../pipeline/pipeline';
import type { ExtensionManager } from '../extension/extension-manager';
import type { PluginManager } from '../extension/plugin/plugin-manager';
import { ensureDefaultRoleFile } from '../role/default-role';
import type { RoleManager } from '../role/role-manager';
import type { SkillManager } from '../skill/skill-manager';
import type { ToolRegistry } from '../tool/tool-registry';
import { registerBuiltinTools } from '../tool/builtin';
import type { WebUiManager } from '../web/webui-manager';

const logger = createScopedLogger('core-lifecycle');

export type CoreLifecycleDependencies = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  skillManager: SkillManager;
  roleManager: RoleManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  llmAdapter: LlmAdapter;
  agentEngine: AgentEngine;
  sessionManager: SessionManager;
  pipeline: Pipeline;
  cronManager: CronManager;
  mcpManager: McpManager;
  extensionManager: ExtensionManager;
  webUiManager: WebUiManager;
};

export class CoreLifecycle {
  private deps: CoreLifecycleDependencies | null = null;
  private _paths: ResolvedPaths | null = null;
  private extensionManager: ExtensionManager | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private shuttingDown = false;

  private get paths(): ResolvedPaths {
    if (!this._paths) throw new Error('路径尚未解析');
    return this._paths;
  }

  private get resolvedDeps(): CoreLifecycleDependencies {
    if (!this.deps) throw new Error('CoreLifecycle 未初始化');
    return this.deps;
  }

  private getPluginManager(): PluginManager {
    if (!this.extensionManager) {
      throw new Error('ExtensionManager 未初始化');
    }
    return this.extensionManager.plugins;
  }

  initialize(deps: CoreLifecycleDependencies): void {
    if (this.deps) {
      logger.warn('CoreLifecycle 已初始化 — 跳过');
      return;
    }
    this.deps = deps;
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
      () => this.resolvedDeps.roleManager.stopWatching(),
      () => this.clearConfigSubscriptions(),
      () => this.resolvedDeps.webUiManager.destroy(),
      () => this.extensionManager?.stopChannels(),
      () => this.extensionManager?.destroy(),
      () => this.resolvedDeps.mcpManager.disconnectAll(),
      () => this.resolvedDeps.mcpManager.destroy(),
      () => this.resolvedDeps.cronManager.destroy(),
      () => this.resolvedDeps.pipeline.destroy(),
      () => this.resolvedDeps.agentEngine.destroy(),
      () => this.resolvedDeps.sessionManager.destroy(),
      () => this.resolvedDeps.llmAdapter.destroy(),
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
    await this.runStep('准备运行时', () => this.prepareRuntime());
    await this.runStep('加载运行时配置', async () => await this.loadRuntimeConfig());
    await this.runStep('初始化核心管理器', async () => await this.initCoreManagers());
    await this.runStep('初始化 Agent 运行时', () => this.initAgentRuntime());
    await this.runStep('初始化扩展运行时', async () => await this.initExtensionRuntime());
    await this.runStep('初始化外围运行时', async () => await this.initPeripheralRuntime());
    await this.runStep('安装运行时热重载', async () => await this.installHotReload());
  }

  // ─── 启动步骤 ───────────────────────────────────────────────

  private prepareRuntime(): void {
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
  }

  private async loadRuntimeConfig(): Promise<void> {
    await this.resolvedDeps.configManager.initialize({ configPath: this.paths.configFile });
    setLogLevel(this.resolvedDeps.configManager.getConfig().server.logLevel);
    logger.info('配置已加载');
  }

  private async initCoreManagers(): Promise<void> {
    await this.resolvedDeps.databaseManager.initialize(this.paths.dbFile);
    this.resolvedDeps.skillManager.initialize({ userSkillsDir: this.paths.userSkillsDir, systemSkillsDir: this.paths.skillsDir });
    await this.resolvedDeps.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);
    this.resolvedDeps.roleManager.initialize({ rolesDir: this.paths.rolesDir });
    await this.resolvedDeps.roleManager.loadAll(this.paths.rolesDir);
  }

  private initAgentRuntime(): void {
    this.resolvedDeps.llmAdapter.initialize({ configManager: this.resolvedDeps.configManager });

    const promptBuilder = new PromptBuilder({
      roleManager: this.resolvedDeps.roleManager,
      skillManager: this.resolvedDeps.skillManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      toolHookDispatcher: this.resolvedDeps.pipeline.hookDispatcher,
    });
    this.resolvedDeps.agentEngine.initialize({
      llmAdapter: this.resolvedDeps.llmAdapter,
      promptBuilder,
    });

    this.resolvedDeps.sessionManager.initialize({
      databaseManager: this.resolvedDeps.databaseManager,
      roleManager: this.resolvedDeps.roleManager,
      agentEngine: this.resolvedDeps.agentEngine,
      configManager: this.resolvedDeps.configManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
    });
  }

  private async initExtensionRuntime(): Promise<void> {
    this.resolvedDeps.pipeline.initialize({
      sessionManager: this.resolvedDeps.sessionManager,
      agentEngine: this.resolvedDeps.agentEngine,
      commandRegistry: this.resolvedDeps.commandRegistry,
    });

    this.extensionManager = this.resolvedDeps.extensionManager;
    this.extensionManager.initialize({
      configManager: this.resolvedDeps.configManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      commandRegistry: this.resolvedDeps.commandRegistry,
      hookRegistry: this.resolvedDeps.pipeline.hookDispatcher,
      pipeline: this.resolvedDeps.pipeline,
      extensionsDir: this.paths.extensionsDir,
    });

    registerBuiltinTools(this.resolvedDeps.toolRegistry, {
      cronManager: this.resolvedDeps.cronManager,
      agentEngine: this.resolvedDeps.agentEngine,
      roleManager: this.resolvedDeps.roleManager,
      llmAdapter: this.resolvedDeps.llmAdapter,
      configManager: this.resolvedDeps.configManager,
      skillManager: this.resolvedDeps.skillManager,
    });
    registerBuiltinCommands(this.resolvedDeps.commandRegistry, {
      roleManager: this.resolvedDeps.roleManager,
      pluginManager: this.getPluginManager(),
      sessionManager: this.resolvedDeps.sessionManager,
      agentEngine: this.resolvedDeps.agentEngine,
    });

    await this.extensionManager.loadPlugins();
    await this.extensionManager.loadChannels();
    await this.extensionManager.startChannels();
  }

  private async initPeripheralRuntime(): Promise<void> {
    this.resolvedDeps.mcpManager.initialize({
      configManager: this.resolvedDeps.configManager,
      toolRegistry: this.resolvedDeps.toolRegistry,
      clientFactory: new SdkMcpClientFactory(),
    });

    // 如果没有配置 MCP,则自动写入示例配置项
    const mcpConfig = this.resolvedDeps.configManager.get('mcp');
    if (mcpConfig.length === 0) {
      await this.resolvedDeps.configManager.update({ mcp: DEFAULT_CONFIG.mcp });
    }

    await this.resolvedDeps.mcpManager.connectAll();

    if (!this.extensionManager) {
      throw new Error('ExtensionManager 未初始化');
    }
    const em = this.extensionManager;
    await this.resolvedDeps.cronManager.initialize({
      databaseManager: this.resolvedDeps.databaseManager,
      pipeline: this.resolvedDeps.pipeline,
      send: async (sessionKey, message) =>
        await em.channels.send(sessionKey, message),
    });

    await this.resolvedDeps.webUiManager.initialize({
      configManager: this.resolvedDeps.configManager,
      databaseManager: this.resolvedDeps.databaseManager,
      sessionManager: this.resolvedDeps.sessionManager,
      cronManager: this.resolvedDeps.cronManager,
      roleManager: this.resolvedDeps.roleManager,
      channelManager: em.channels,
      pluginManager: this.getPluginManager(),
      toolRegistry: this.resolvedDeps.toolRegistry,
      skillManager: this.resolvedDeps.skillManager,
    });
  }

  private async installHotReload(): Promise<void> {
    await this.resolvedDeps.configManager.syncDefaults();
    this.installConfigSubscriptions();

    this.resolvedDeps.configManager.startHotReload();
    this.resolvedDeps.roleManager.startWatching();
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

  private installConfigSubscriptions(): void {
    this.clearConfigSubscriptions();
    this.unsubscribers.push(
      this.resolvedDeps.configManager.subscribe('server', (server) => {
        setLogLevel(server.logLevel);
      }),
      this.resolvedDeps.configManager.subscribe('plugins', async () => {
        await this.extensionManager?.plugins.handleConfigReload();
      }),
      this.resolvedDeps.configManager.subscribe('mcp', async () => {
        await this.resolvedDeps.mcpManager.handleConfigReload();
      }),
      this.resolvedDeps.configManager.subscribe('channels', async () => {
        await this.extensionManager?.channels.handleConfigReload();
      }),
      this.resolvedDeps.roleManager.subscribeChanges(() => {
        this.resolvedDeps.sessionManager.clearCachedSessions();
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
}
