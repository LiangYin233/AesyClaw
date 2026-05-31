/**
 * app — 应用入口。
 *
 * 创建并编排所有子系统的生命周期。
 */

import { AgentRegistry } from './agent/registry';
import { AgentFactory } from './agent/agent-factory';
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
import { PluginManager } from './extension/plugin/manager';
import { ChannelManager } from './extension/channel/manager';
import { createAutoCompactHook, createTimeInjectHook, createCommandDetectHook } from './hook/builtin';
import { WebUiManager } from './web/webui-manager';
import { createScopedLogger, setLogLevel } from './core/logger';
import { DEFAULT_CONFIG } from './core/config/defaults';
import path from 'node:path';
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

  const compressionThreshold = configManager.get('agent.memory.compressionThreshold') as number;
  const sessionManager = new SessionManager(
    databaseManager,
    () => configManager.get('agent.defaultModel') as string,
    () => roleManager.getDefaultRole().id,
    path.join(configManager.resolvedPaths.dataDir, 'sessions'),
  );
  const hooksBus = new HooksBus();

  const agentFactory = new AgentFactory({
    llmAdapter,
    roleManager,
    skillManager,
    toolRegistry,
    hooksBus,
    compressionThreshold,
    registry: agentRegistry,
  });

  const pipeline = new Pipeline({
    sessionManager,
    roleManager,
    databaseManager,
    agentRegistry,
    agentFactory,
    hooksBus,
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
  private pluginManager: PluginManager | null = null;
  private channelManager: ChannelManager | null = null;
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
      // 1. 停止配置热重载
      () => this.sub.configManager.stopHotReload(),
      () => this.sub.roleStore.stopHotReload(),
      // 2. 停止外围运行时（依赖 pipeline 的子系统）
      () => this.webUiManager?.destroy(),
      () => this.cronManager?.destroy(),
      () => this.sub.roleManager.destroy(),
      // 3. 停止扩展（频道+插件）：此时 pipeline/hooksBus 仍可用，
      //    但频道 destroy 中不应有出站消息发送
      () => this.channelManager?.destroy(),
      () => this.pluginManager?.destroy(),
      // 4. 断开 MCP（MCP 工具已不再被调用）
      () => this.sub.mcpManager.disconnectAll(),
      // 5. 销毁 pipeline（清空 hooksBus）
      () => this.sub.pipeline.destroy(),
      // 6. 关闭数据库
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

    // 注册内置 Hook（通过注入而非 Pipeline 硬编码）
    this.sub.pipeline.hooksBus.register(createCommandDetectHook(this.sub.commandRegistry));
    this.sub.pipeline.hooksBus.register(
      createAutoCompactHook(this.sub.llmAdapter, this.sub.configManager.get('agent.memory.compressionThreshold') as number),
    );
    this.sub.pipeline.hooksBus.register(createTimeInjectHook());

    // ChannelManager 先于 PluginManager 构造（PluginManager 可选依赖 ChannelManager）
    this.channelManager = new ChannelManager({
      configManager: this.sub.configManager,
      pipeline: this.sub.pipeline,
      hooksBus: this.sub.pipeline.hooksBus,
      paths: this.paths,
      toolRegistry: this.sub.toolRegistry,
      commandRegistry: this.sub.commandRegistry,
      sessionManager: this.sub.sessionManager,
      llmAdapter: this.sub.llmAdapter,
      databaseManager: this.sub.databaseManager,
    });
    this.pluginManager = new PluginManager({
      configManager: this.sub.configManager,
      toolRegistry: this.sub.toolRegistry,
      commandRegistry: this.sub.commandRegistry,
      hooksBus: this.sub.pipeline.hooksBus,
      channelManager: this.channelManager,
      paths: this.paths,
      llmAdapter: this.sub.llmAdapter,
    });

    registerBuiltinCommands(this.sub.commandRegistry, {
      roleManager: this.sub.roleManager,
      pluginManager: this.pluginManager,
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

    // 先加载插件（插件 init 期间可能注册频道），再注册磁盘频道并启动全部
    await this.pluginManager.setup();
    await this.channelManager.setup();
  }

  private async initPeripheralRuntime(): Promise<void> {
    const mcpConfig = this.sub.configManager.get('mcp') as typeof DEFAULT_CONFIG.mcp;
    if (mcpConfig.length === 0) {
      await this.sub.configManager.set('mcp', DEFAULT_CONFIG.mcp);
    }
    await this.sub.mcpManager.connectAll();

    if (!this.channelManager) throw new Error('ChannelManager 未初始化');
    if (!this.pluginManager) throw new Error('PluginManager 未初始化');

    this.cronManager = new CronManager({
      databaseManager: this.sub.databaseManager,
      pipeline: this.sub.pipeline,
      hooksBus: this.sub.pipeline.hooksBus,
      sessionManager: this.sub.sessionManager,
      send: async (signal) => await this.channelManager!.send(signal),
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
      channelManager: this.channelManager,
      pluginManager: this.pluginManager,
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

    // 配置文件变更后自动热重载插件和频道配置
    this.sub.configManager.onConfigReloaded = () => {
      void this.pluginManager?.handleConfigReload().catch((err) => {
        logger.error('插件配置热重载失败', err);
      });
      void this.channelManager?.handleConfigReload().catch((err) => {
        logger.error('频道配置热重载失败', err);
      });
    };
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
