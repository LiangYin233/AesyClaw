/**
 * app — 应用入口。
 *
 * 创建并编排所有子系统的生命周期。
 */

import { AgentRegistry } from './agent/registry';
import { ConfigManager } from './core/config/config-manager';
import { DatabaseManager } from './core/database/database-manager';
import { McpManager } from './tool/mcp/mcp-manager';
import { SdkMcpClientFactory } from './tool/mcp/sdk-mcp-client';
import { Pipeline } from './pipeline/pipeline';
import { HooksBus } from './hook';
import { LlmAdapter } from './agent/llm/adapter';
import { SessionManager } from './session/manager';
import { CommandRegistry } from './command/command-registry';
import { RoleManager } from './role/manager';
import { RoleStore } from './role/store';
import { SkillManager } from './skill/manager';
import { ToolRegistry } from './tool/tool-registry';
import { registerBuiltinCommands } from './command/builtin';
import { registerBuiltinTools } from './tool/builtin';
import { CronManager } from './cron/manager';
import { ExtensionManager } from './extension/extension-manager';
import { WebUiManager } from './web/webui-manager';
import { createAgentFactory } from './agent/factory';
import { createRoleResolver } from './agent/role-resolver';
import { createScopedLogger, setLogLevel } from './core/logger';
import { DEFAULT_CONFIG } from './core/config/defaults';
import type { ResolvedPaths } from './core/path-resolver';
const logger = createScopedLogger('app');

type Deps = {
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

function createSubsystems(): Deps {
  const agentRegistry = new AgentRegistry();
  const configManager = new ConfigManager();
  const databaseManager = new DatabaseManager();
  const roleStore = new RoleStore(configManager.resolvedPaths.rolesFile);
  const roleManager = new RoleManager(roleStore);
  const skillManager = new SkillManager();
  const toolRegistry = new ToolRegistry();
  const commandRegistry = new CommandRegistry();
  const llmAdapter = new LlmAdapter(configManager);
  const sessionManager = new SessionManager(databaseManager);

  const compressionThreshold = configManager.get('agent.memory.compressionThreshold') as number;
  const hooksBus = new HooksBus();

  const agentFactory = createAgentFactory({
    llmAdapter,
    roleManager,
    skillManager,
    toolRegistry,
    hooksBus,
    compressionThreshold,
    agentRegistry,
  });
  const roleResolver = createRoleResolver();

  const pipeline = new Pipeline({
    sessionManager,
    commandRegistry,
    roleManager,
    databaseManager,
    agentRegistry,
    hooksBus,
    llmAdapter,
    compressionThreshold,
    agentFactory,
    roleResolver,
  });

  const mcpManager = new McpManager(configManager, toolRegistry, new SdkMcpClientFactory());

  return {
    configManager,
    databaseManager,
    roleStore,
    roleManager,
    skillManager,
    toolRegistry,
    commandRegistry,
    llmAdapter,
    sessionManager,
    pipeline,
    mcpManager,
    agentRegistry,
  };
}

export class Application {
  private sub: Deps;
  private extensionManager: ExtensionManager | null = null;
  private webUiManager: WebUiManager | null = null;
  private cronManager: CronManager | null = null;
  private shuttingDown = false;
  private started = false;

  constructor() {
    this.sub = createSubsystems();
  }

  private get paths(): Readonly<ResolvedPaths> {
    return this.sub.configManager.resolvedPaths;
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

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    logger.info('正在关闭 AesyClaw...');

    const steps: Array<() => Promise<void> | void> = [
      () => this.sub.configManager.stopHotReload(),
      () => this.sub.roleStore.stopHotReload(),
      () => this.webUiManager?.destroy(),
      () => this.cronManager?.destroy(),
      () => this.sub.roleManager.destroy(),
      () => this.extensionManager?.destroy(),
      () => this.sub.mcpManager.disconnectAll(),
      () => this.sub.pipeline.destroy(),
      () => this.sub.databaseManager.destroy(),
    ];

    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        logger.error('关闭步骤失败', err);
      }
    }
    logger.info('AesyClaw 关闭完成');
    this.started = false;
  }

  private async runStartupSequence(): Promise<void> {
    await this.runStep('初始化核心管理器', () => this.initCoreManagers());
    await this.runStep('初始化扩展运行时', () => this.initExtensionRuntime());
    await this.runStep('初始化外围运行时', () => this.initPeripheralRuntime());
    await this.runStep('安装运行时热重载', () => this.installHotReload());
  }

  private async initCoreManagers(): Promise<void> {
    setLogLevel(this.sub.configManager.get('server.logLevel') as string);
    await this.sub.databaseManager.initialize(this.paths.dbFile);
    await this.sub.skillManager.loadAll(this.paths.userSkillsDir, this.paths.skillsDir);
    await this.sub.roleManager.initialize();
  }

  private async initExtensionRuntime(): Promise<void> {
    await this.sub.pipeline.initialize();

    this.extensionManager = new ExtensionManager({
      configManager: this.sub.configManager,
      toolRegistry: this.sub.toolRegistry,
      commandRegistry: this.sub.commandRegistry,
      hooksBus: this.sub.pipeline.hooksBus,
      pipeline: this.sub.pipeline,
      paths: this.paths,
      llmAdapter: this.sub.llmAdapter,
    });

    registerBuiltinCommands(this.sub.commandRegistry, {
      roleManager: this.sub.roleManager,
      pluginManager: this.extensionManager,
      sessionManager: this.sub.sessionManager,
      llmAdapter: this.sub.llmAdapter,
      skillManager: this.sub.skillManager,
      toolRegistry: this.sub.toolRegistry,
      hooksBus: this.sub.pipeline.hooksBus,
      databaseManager: this.sub.databaseManager,
      compressionThreshold: this.sub.configManager.get(
        'agent.memory.compressionThreshold',
      ) as number,
      agentRegistry: this.sub.agentRegistry,
    });

    await this.extensionManager.setup();
  }

  private async initPeripheralRuntime(): Promise<void> {
    const mcpConfig = this.sub.configManager.get('mcp') as typeof DEFAULT_CONFIG.mcp;
    if (mcpConfig.length === 0) {
      await this.sub.configManager.set('mcp', DEFAULT_CONFIG.mcp);
    }
    await this.sub.mcpManager.connectAll();

    if (!this.extensionManager) throw new Error('ExtensionManager 未初始化');
    const em = this.extensionManager;

    this.cronManager = new CronManager({
      databaseManager: this.sub.databaseManager,
      pipeline: this.sub.pipeline,
      hooksBus: this.sub.pipeline.hooksBus,
      sessionManager: this.sub.sessionManager,
      send: async (signal) => await em.channels.send(signal),
    });
    await this.cronManager.initialize();

    registerBuiltinTools(this.sub.toolRegistry, {
      cronManager: this.cronManager,
      roleManager: this.sub.roleManager,
      skillManager: this.sub.skillManager,
      agentRegistry: this.sub.agentRegistry,
    });

    this.webUiManager = new WebUiManager({
      configManager: this.sub.configManager,
      databaseManager: this.sub.databaseManager,
      sessionManager: this.sub.sessionManager,
      cronManager: this.cronManager,
      roleManager: this.sub.roleManager,
      channelManager: em.channels,
      pluginManager: em,
      toolRegistry: this.sub.toolRegistry,
      skillManager: this.sub.skillManager,
      paths: this.paths,
    });
    await this.webUiManager.initialize();
  }

  private async installHotReload(): Promise<void> {
    await this.sub.configManager.syncDefaults();
    this.sub.configManager.startHotReload();
    this.sub.roleStore.startHotReload();
  }

  private async runStep(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      logger.info(`✓ ${name}`);
    } catch (err) {
      logger.error(`启动步骤 "${name}" 失败`, err);
      await this.shutdown();
      throw err;
    }
  }
}
