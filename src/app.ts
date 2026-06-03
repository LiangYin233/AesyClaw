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
import { SkillManager } from './skill/manager';
import { ToolRegistry } from './tool/tool-registry';
import { registerBuiltinCommands } from './command/builtin';
import { registerBuiltinTools } from './tool/builtin';
import { CronManager } from './cron/manager';
import { PluginManager } from './extension/plugin/manager';
import { RuntimeControlHub } from './extension/plugin/control';
import { ChannelManager } from './extension/channel/manager';
import {
  createAutoCompactHook,
  createTimeInjectHook,
  createCommandDetectHook,
  createUserInputBudgetGuardHook,
  createSkillPromptHook,
  createRolePromptHook,
  createCommunicationPromptHook,
  createToolResultTruncationHook,
} from './hook/builtin';
import { WebUiManager } from './web/webui-manager';
import type { WebRuntimeDependencies } from './web/types';
import { createScopedLogger, setLogLevel } from './core/logger';
import { DEFAULT_CONFIG } from './core/config/defaults';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
const logger = createScopedLogger('app');

type Deps = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  llmAdapter: LlmAdapter;
  sessionManager: SessionManager;
  pipeline: Pipeline;
  mcpManager: McpManager;
  agentRegistry: AgentRegistry;
  agentFactory: AgentFactory;
  runtimeControl: RuntimeControlHub;
};

function createSubsystems(): Deps {
  const agentRegistry = new AgentRegistry();
  const configManager = new ConfigManager();
  const databaseManager = new DatabaseManager();
  const roleManager = new RoleManager(configManager.resolvedPaths.rolesFile);
  const skillManager = new SkillManager();
  const toolRegistry = new ToolRegistry();
  const commandRegistry = new CommandRegistry();
  const llmAdapter = new LlmAdapter(configManager);
  const runtimeControl = new RuntimeControlHub();

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
    roleManager,
    skillManager,
    toolRegistry,
    commandRegistry,
    llmAdapter,
    sessionManager,
    pipeline,
    mcpManager,
    agentRegistry,
    agentFactory,
    runtimeControl,
  };
}

type ExtensionRuntime = {
  channelManager: ChannelManager;
  pluginManager: PluginManager;
};

type RuntimeService = {
  name: string;
  priority: number;
  start: (ctx: RuntimeContext) => Promise<void> | void;
};

type Runtime = {
  dispose: () => Promise<void>;
};

class RuntimeContext {
  private readonly values = new Map<string, unknown>();
  private readonly disposers: Array<() => Promise<void> | void> = [];
  private disposed = false;

  constructor(readonly sub: Deps) {}

  get<T>(key: string): T {
    if (!this.values.has(key)) {
      throw new Error(`运行时服务 "${key}" 未初始化`);
    }
    return this.values.get(key) as T;
  }

  own<T>(key: string, value: T, dispose: (value: T) => Promise<void> | void): T {
    this.values.set(key, value);
    this.defer(() => dispose(value));
    return value;
  }

  defer(dispose: () => Promise<void> | void): void {
    this.disposers.push(dispose);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    for (const dispose of [...this.disposers].reverse()) {
      try {
        await dispose();
      } catch (err) {
        logger.error('关闭步骤失败', err);
      }
    }
  }
}

class RuntimeRunner {
  private constructor(private readonly ctx: RuntimeContext) {}

  static async start(services: RuntimeService[]): Promise<RuntimeRunner> {
    const ctx = new RuntimeContext(createSubsystems());
    const ordered = [...services].sort((a, b) => a.priority - b.priority);

    try {
      for (const service of ordered) {
        await runStep(service.name, async () => {
          await service.start(ctx);
        });
      }
    } catch (err) {
      await ctx.dispose();
      throw err;
    }

    return new RuntimeRunner(ctx);
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

export class Application {
  private runtime: Runtime | null = null;
  private shuttingDown = false;

  async start(): Promise<void> {
    if (this.runtime) {
      logger.warn('应用已启动');
      return;
    }

    logger.info('正在启动 AesyClaw...');
    this.runtime = await RuntimeRunner.start(defaultRuntimeServices());
    logger.info('AesyClaw 启动成功');
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown || !this.runtime) return;

    this.shuttingDown = true;
    logger.info('正在关闭 AesyClaw...');
    try {
      await this.runtime.dispose();
      this.runtime = null;
      logger.info('AesyClaw 关闭完成');
    } finally {
      this.shuttingDown = false;
    }
  }
}

function defaultRuntimeServices(): RuntimeService[] {
  return [
    coreService(),
    builtinHookService(),
    webAuthTokenService(),
    extensionService(),
    cronService(),
    builtinToolService(),
    mcpService(),
    webService(),
    hotReloadService(),
  ];
}

function coreService(): RuntimeService {
  return {
    name: '初始化核心管理器',
    priority: 0,
    async start(ctx) {
      const sub = ctx.sub;
      ctx.defer(() => sub.databaseManager.destroy());
      ctx.defer(() => sub.pipeline.destroy());
      ctx.defer(() => sub.roleManager.destroy());

      setLogLevel(sub.configManager.get('server.logLevel') as string);

      const paths = sub.configManager.resolvedPaths;
      await Promise.all([
        sub.databaseManager.initialize(paths.dbFile),
        sub.skillManager.loadAll(paths.userSkillsDir, paths.skillsDir),
      ]);
    },
  };
}

function builtinHookService(): RuntimeService {
  return {
    name: '安装内置 Hook',
    priority: 10,
    start(ctx) {
      const sub = ctx.sub;
      const hooksBus = sub.pipeline.hooksBus;
      hooksBus.register(createCommandDetectHook(sub.commandRegistry));
      hooksBus.register(createTimeInjectHook());
      hooksBus.register(createUserInputBudgetGuardHook());
      hooksBus.register(
        createAutoCompactHook(
          sub.llmAdapter,
          sub.configManager.get('agent.memory.compressionThreshold') as number,
        ),
      );
      hooksBus.register(createSkillPromptHook(sub.skillManager));
      hooksBus.register(createCommunicationPromptHook());
      hooksBus.register(createRolePromptHook(sub.roleManager));
      hooksBus.register(createToolResultTruncationHook());
    },
  };
}

function webAuthTokenService(): RuntimeService {
  return {
    name: '确保 WebUI 认证令牌',
    priority: 15,
    async start(ctx) {
      const existing = ctx.sub.configManager.get('server.authToken') as string | undefined;
      if (existing) return;

      const token = randomBytes(32).toString('hex');
      await ctx.sub.configManager.set('server.authToken', token);
      logger.info('已自动生成 WebUI 认证令牌', {
        hint: `${token.slice(0, 4)}…${token.slice(-4)}`,
        configPath: 'server.authToken',
      });
    },
  };
}

function extensionService(): RuntimeService {
  return {
    name: '初始化扩展运行时',
    priority: 20,
    async start(ctx) {
      const sub = ctx.sub;
      const paths = sub.configManager.resolvedPaths;
      const channelManager = new ChannelManager({
        configManager: sub.configManager,
        pipeline: sub.pipeline,
        hooksBus: sub.pipeline.hooksBus,
        paths,
        toolRegistry: sub.toolRegistry,
        commandRegistry: sub.commandRegistry,
        sessionManager: sub.sessionManager,
        llmAdapter: sub.llmAdapter,
        databaseManager: sub.databaseManager,
      });
      const pluginManager = new PluginManager({
        configManager: sub.configManager,
        toolRegistry: sub.toolRegistry,
        commandRegistry: sub.commandRegistry,
        hooksBus: sub.pipeline.hooksBus,
        paths,
        llmAdapter: sub.llmAdapter,
        control: sub.runtimeControl,
      });
      const extensions = ctx.own<ExtensionRuntime>(
        'extensions',
        { channelManager, pluginManager },
        async ({ channelManager, pluginManager }) => {
          await channelManager.destroy();
          await pluginManager.destroy();
        },
      );

      registerBuiltinCommands(sub.commandRegistry, {
        roleManager: sub.roleManager,
        pluginManager,
        sessionManager: sub.sessionManager,
        llmAdapter: sub.llmAdapter,
        skillManager: sub.skillManager,
        toolRegistry: sub.toolRegistry,
        hooksBus: sub.pipeline.hooksBus,
        databaseManager: sub.databaseManager,
        compressionThreshold: sub.configManager.get('agent.memory.compressionThreshold') as number,
        agentRegistry: sub.agentRegistry,
        agentFactory: sub.agentFactory,
      });

      await extensions.pluginManager.setup();
      await extensions.channelManager.setup();
    },
  };
}

function cronService(): RuntimeService {
  return {
    name: '初始化定时任务',
    priority: 30,
    async start(ctx) {
      const sub = ctx.sub;
      const { channelManager } = ctx.get<ExtensionRuntime>('extensions');
      const cronManager = ctx.own(
        'cronManager',
        new CronManager({
          databaseManager: sub.databaseManager,
          pipeline: sub.pipeline,
          hooksBus: sub.pipeline.hooksBus,
          sessionManager: sub.sessionManager,
          send: async (signal) => await channelManager.send(signal),
        }),
        async (cronManager) => {
          await cronManager.destroy();
        },
      );
      sub.runtimeControl.bind(createWebRuntimeDependencies(ctx));
      ctx.defer(() => sub.runtimeControl.reset());
      await cronManager.initialize();
    },
  };
}

function builtinToolService(): RuntimeService {
  return {
    name: '注册内置工具',
    priority: 40,
    start(ctx) {
      const sub = ctx.sub;
      registerBuiltinTools(sub.toolRegistry, {
        cronManager: ctx.get<CronManager>('cronManager'),
        roleManager: sub.roleManager,
        skillManager: sub.skillManager,
        agentRegistry: sub.agentRegistry,
      });
    },
  };
}

function mcpService(): RuntimeService {
  return {
    name: '连接 MCP',
    priority: 50,
    async start(ctx) {
      const sub = ctx.sub;
      const mcpConfig = sub.configManager.get('mcp') as typeof DEFAULT_CONFIG.mcp;
      if (mcpConfig.length === 0) {
        await sub.configManager.set('mcp', DEFAULT_CONFIG.mcp);
      }

      ctx.defer(() => sub.mcpManager.disconnectAll());
      void sub.mcpManager.connectAll().catch((err) => {
        logger.error('MCP 服务器连接失败', err);
      });
    },
  };
}

function webService(): RuntimeService {
  return {
    name: '启动 WebUI',
    priority: 60,
    async start(ctx) {
      const webUiManager = ctx.own(
        'webUiManager',
        new WebUiManager(createWebRuntimeDependencies(ctx)),
        async (webUiManager) => {
          await webUiManager.destroy();
        },
      );
      await webUiManager.initialize();
    },
  };
}

function createWebRuntimeDependencies(ctx: RuntimeContext): WebRuntimeDependencies {
  const sub = ctx.sub;
  const { channelManager, pluginManager } = ctx.get<ExtensionRuntime>('extensions');
  return {
    configManager: sub.configManager,
    databaseManager: sub.databaseManager,
    sessionManager: sub.sessionManager,
    cronManager: ctx.get<CronManager>('cronManager'),
    roleManager: sub.roleManager,
    channelManager,
    pluginManager,
    toolRegistry: sub.toolRegistry,
    skillManager: sub.skillManager,
    agentRegistry: sub.agentRegistry,
    paths: sub.configManager.resolvedPaths,
  };
}

function hotReloadService(): RuntimeService {
  return {
    name: '安装运行时热重载',
    priority: 70,
    async start(ctx) {
      const sub = ctx.sub;
      const extensions = ctx.get<ExtensionRuntime>('extensions');
      ctx.defer(() => sub.configManager.stopHotReload());
      ctx.defer(() => sub.roleManager.stopHotReload());

      await sub.configManager.syncDefaults();
      sub.configManager.startHotReload();
      sub.roleManager.startHotReload();

      sub.configManager.onConfigReloaded = () => {
        void extensions.pluginManager.handleConfigReload().catch((err) => {
          logger.error('插件配置热重载失败', err);
        });
        void extensions.channelManager.handleConfigReload().catch((err) => {
          logger.error('频道配置热重载失败', err);
        });
        void sub.mcpManager.handleConfigReload().catch((err) => {
          logger.error('MCP 配置热重载失败', err);
        });
      };
    },
  };
}

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    logger.info(`✓ ${name}`);
  } catch (err) {
    logger.error(`启动步骤 "${name}" 失败`, err);
    throw err;
  }
}
