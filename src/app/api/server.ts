import express from 'express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentRuntime } from '../../agent/index.js';
import type { SessionManager } from '../../features/sessions/application/SessionManager.js';
import type { ChannelManager } from '../../features/channels/application/ChannelManager.js';
import type { Config } from '../../types.js';
import type { Database } from '../../platform/db/index.js';
import type { PluginManager } from '../../features/plugins/index.js';
import type { CronRuntimeService } from '../../features/cron/index.js';
import type { McpClientManager } from '../../features/mcp/index.js';
import type { SkillManager } from '../../features/skills/application/SkillManager.js';
import type { ToolRegistry } from '../../platform/tools/ToolRegistry.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import { ConfigManager, RuntimeConfigStore } from '../../features/config/index.js';
import { UnauthorizedError } from './errors.js';
import { logger } from '../../platform/observability/index.js';
import { accessLogMiddleware } from './middleware/access-log.js';
import { apiErrorHandler } from './middleware/error-handler.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import type { LongTermMemoryStore } from '../../features/sessions/infrastructure/LongTermMemoryStore.js';
import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import { registerApiControllers } from '../../features/registerApiControllers.js';

const MAX_MESSAGE_LENGTH = 50000;

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const packageVersion = packageJson.version;

export class APIServer {
  private app = express();
  private server = createServer(this.app);
  private log = logger.child('API');
  private port: number;
  private agentRuntime: AgentRuntime;
  private db: Database;
  private sessionManager: SessionManager;
  private sessionRouting: SessionRoutingService;
  private channelManager: ChannelManager;
  private configStore: RuntimeConfigStore;
  private configManager: ConfigManager;
  private pluginManager?: PluginManager;
  private cronService?: CronRuntimeService;
  private mcpManager?: McpClientManager;
  private skillManager?: SkillManager;
  private toolRegistry?: ToolRegistry;
  private longTermMemoryStore: LongTermMemoryStore;
  private agentRoleService?: AgentRoleService;

  constructor(options: {
    port: number;
    agentRuntime: AgentRuntime;
    db: Database;
    sessionManager: SessionManager;
    sessionRouting: SessionRoutingService;
    channelManager: ChannelManager;
    configStore: RuntimeConfigStore;
    configManager: ConfigManager;
    pluginManager?: PluginManager;
    cronService?: CronRuntimeService;
    mcpManager?: McpClientManager;
    skillManager?: SkillManager;
    toolRegistry?: ToolRegistry;
    longTermMemoryStore: LongTermMemoryStore;
    agentRoleService?: AgentRoleService;
  }) {
    this.port = options.port;
    this.agentRuntime = options.agentRuntime;
    this.db = options.db;
    this.sessionManager = options.sessionManager;
    this.sessionRouting = options.sessionRouting;
    this.channelManager = options.channelManager;
    this.configStore = options.configStore;
    this.configManager = options.configManager;
    this.pluginManager = options.pluginManager;
    this.cronService = options.cronService;
    this.mcpManager = options.mcpManager;
    this.skillManager = options.skillManager;
    this.toolRegistry = options.toolRegistry;
    this.longTermMemoryStore = options.longTermMemoryStore;
    this.agentRoleService = options.agentRoleService;
  }

  async start(): Promise<void> {
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.log.info(`API 服务已启动: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  private setupMiddleware(): void {
    const MAX_REQUEST_SIZE = 10 * 1024 * 1024;
    this.app.use(requestIdMiddleware);
    this.app.use(accessLogMiddleware);
    this.app.use(express.json({ limit: MAX_REQUEST_SIZE }));
    this.app.use(express.urlencoded({ extended: true, limit: MAX_REQUEST_SIZE }));

    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.sendStatus(200);
      next();
    });

    this.app.use((req, res, next) => {
      if (!req.path.startsWith('/api')) {
        return next();
      }

      const requestToken = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
      const expectedToken = this.configStore.getConfig().server.token;

      if (typeof requestToken === 'string' && expectedToken && requestToken === expectedToken) {
        return next();
      }

      return next(new UnauthorizedError('Unauthorized: invalid or missing token'));
    });
  }

  private setupRoutes(): void {
    const getConfig = () => this.configStore.getConfig();
    const updateConfig = (mutator: (config: Config) => void | Config | Promise<void | Config>) =>
      this.configManager.update(mutator);
    const getMcpManager = () => this.mcpManager;
    const setMcpManager = (manager: McpClientManager) => {
      this.mcpManager = manager;
    };

    registerApiControllers({
      app: this.app,
      packageVersion,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      agentRuntime: this.agentRuntime,
      db: this.db,
      sessionManager: this.sessionManager,
      sessionRouting: this.sessionRouting,
      agentRoleService: this.agentRoleService,
      channelManager: this.channelManager,
      getConfig,
      updateConfig,
      toolRegistry: this.toolRegistry,
      longTermMemoryStore: this.longTermMemoryStore,
      pluginManager: this.pluginManager,
      cronService: this.cronService,
      getMcpManager,
      setMcpManager,
      skillManager: this.skillManager,
      log: this.log
    });
  }

  private setupErrorHandling(): void {
    this.app.use(apiErrorHandler);
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log.info('API 服务已停止');
        resolve();
      });
    });
  }

  updateConfig(config: Config): void {
    this.configStore.setConfig(config);
    this.log.info('配置已更新');
  }
}
