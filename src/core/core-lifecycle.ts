/** CoreLifecycle — 核心生命周期协调器，负责启动序列和关闭。 */

import { mkdirSync } from 'node:fs';
import type { AgentEngine } from '../agent/agent-engine';
import type { LlmAdapter } from '../agent/llm-adapter';
import { PromptBuilder } from '../agent/prompt-builder';
import type { SessionManager } from '../agent/session-manager';
import type { ChannelManager } from '../channel/channel-manager';
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
import { PluginLoader } from '../plugin/plugin-loader';
import { PluginManager } from '../plugin/plugin-manager';
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
  channelManager: ChannelManager;
  webUiManager: WebUiManager;
};

export class CoreLifecycle {
  private deps: CoreLifecycleDependencies | null = null;
  private _paths: ResolvedPaths | null = null;
  private pluginManager: PluginManager | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private shuttingDown = false;

  private get paths(): ResolvedPaths {
    if (!this._paths) throw new Error('Paths not resolved');
    return this._paths;
  }

  private get d(): CoreLifecycleDependencies {
    if (!this.deps) throw new Error('CoreLifecycle 未初始化');
    return this.deps;
  }

  private getPluginManager(): PluginManager {
    if (!this.pluginManager) {
      throw new Error('PluginManager 未初始化');
    }
    return this.pluginManager;
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
      () => this.d.configManager.stopHotReload(),
      () => this.d.roleManager.stopWatching(),
      () => this.clearConfigSubscriptions(),
      () => this.d.webUiManager.destroy(),
      () => this.d.channelManager.stopAll(),
      () => this.d.channelManager.destroy(),
      () => this.d.mcpManager.disconnectAll(),
      () => this.d.mcpManager.destroy(),
      () => this.d.cronManager.destroy(),
      () => this.pluginManager?.destroy(),
      () => this.d.pipeline.destroy(),
      () => this.d.agentEngine.destroy(),
      () => this.d.sessionManager.destroy(),
      () => this.d.llmAdapter.destroy(),
      () => this.d.databaseManager.close(),
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
    await this.d.configManager.load(this.paths.configFile);
    setLogLevel(this.d.configManager.getConfig().server.logLevel);
    logger.info('配置已加载');
  }

  private async initCoreManagers(): Promise<void> {
    await this.d.databaseManager.initialize(this.paths.dbFile);
    await this.d.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);
    await this.d.roleManager.loadAll(this.paths.rolesDir);
  }

  private initAgentRuntime(): void {
    this.d.llmAdapter.initialize({ configManager: this.d.configManager });

    const promptBuilder = new PromptBuilder({
      roleManager: this.d.roleManager,
      skillManager: this.d.skillManager,
      toolRegistry: this.d.toolRegistry,
      toolHookDispatcher: this.d.pipeline.hookDispatcher,
    });
    this.d.agentEngine.initialize({
      llmAdapter: this.d.llmAdapter,
      promptBuilder,
    });

    this.d.sessionManager.initialize({
      databaseManager: this.d.databaseManager,
      roleManager: this.d.roleManager,
      agentEngine: this.d.agentEngine,
      configManager: this.d.configManager,
      llmAdapter: this.d.llmAdapter,
    });
  }

  private async initExtensionRuntime(): Promise<void> {
    this.d.pipeline.initialize({
      sessionManager: this.d.sessionManager,
      agentEngine: this.d.agentEngine,
      commandRegistry: this.d.commandRegistry,
    });

    this.pluginManager = new PluginManager();
    this.pluginManager.initialize({
      configManager: this.d.configManager,
      toolRegistry: this.d.toolRegistry,
      commandRegistry: this.d.commandRegistry,
      hookRegistry: this.d.pipeline.hookDispatcher,
      channelManager: this.d.channelManager,
      pluginLoader: new PluginLoader({ extensionsDir: this.paths.extensionsDir }),
    });

    registerBuiltinTools(this.d.toolRegistry, {
      cronManager: this.d.cronManager,
      agentEngine: this.d.agentEngine,
      roleManager: this.d.roleManager,
      llmAdapter: this.d.llmAdapter,
      configManager: this.d.configManager,
      skillManager: this.d.skillManager,
    });
    registerBuiltinCommands(this.d.commandRegistry, {
      roleManager: this.d.roleManager,
      pluginManager: this.getPluginManager(),
      sessionManager: this.d.sessionManager,
      agentEngine: this.d.agentEngine,
    });

    await this.getPluginManager().loadAll();
  }

  private async initPeripheralRuntime(): Promise<void> {
    this.d.mcpManager.initialize({
      configManager: this.d.configManager,
      toolRegistry: this.d.toolRegistry,
      clientFactory: new SdkMcpClientFactory(),
    });

    // 如果没有配置 MCP,则自动写入示例配置项
    const mcpConfig = this.d.configManager.get('mcp');
    if (mcpConfig.length === 0) {
      await this.d.configManager.update({ mcp: DEFAULT_CONFIG.mcp });
    }

    await this.d.mcpManager.connectAll();

    this.d.channelManager.initialize({
      configManager: this.d.configManager,
      pipeline: this.d.pipeline,
    });
    await this.d.channelManager.registerFromDisk(this.paths.extensionsDir);
    await this.d.channelManager.startAll();

    await this.d.cronManager.initialize({
      databaseManager: this.d.databaseManager,
      pipeline: this.d.pipeline,
      send: async (sessionKey, message) => await this.d.channelManager.send(sessionKey, message),
    });

    await this.d.webUiManager.initialize({
      configManager: this.d.configManager,
      databaseManager: this.d.databaseManager,
      sessionManager: this.d.sessionManager,
      cronManager: this.d.cronManager,
      roleManager: this.d.roleManager,
      channelManager: this.d.channelManager,
      pluginManager: this.getPluginManager(),
      toolRegistry: this.d.toolRegistry,
      skillManager: this.d.skillManager,
    });
  }

  private async installHotReload(): Promise<void> {
    await this.d.configManager.syncDefaults();
    this.installConfigSubscriptions();

    this.d.configManager.startHotReload();
    this.d.roleManager.startWatching();
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
      this.d.configManager.subscribe('server', (server) => {
        setLogLevel(server.logLevel);
      }),
      this.d.configManager.subscribe('plugins', async () => {
        await this.pluginManager?.handleConfigReload();
      }),
      this.d.configManager.subscribe('mcp', async () => {
        await this.d.mcpManager.handleConfigReload();
      }),
      this.d.configManager.subscribe('channels', async () => {
        await this.d.channelManager.handleConfigReload();
      }),
      this.d.roleManager.subscribeChanges(() => {
        this.d.sessionManager.clearCachedSessions();
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
