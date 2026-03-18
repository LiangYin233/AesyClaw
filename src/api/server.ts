import express from 'express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentRuntime } from '../agent/runtime/AgentRuntime.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import type { PluginManager } from '../plugins/index.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { SessionRoutingService } from '../agent/session/SessionRoutingService.js';
import { createErrorResponse } from '../errors/index.js';
import { logger } from '../observability/index.js';
import { CONSTANTS } from '../constants/index.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerPluginRoutes } from './routes/plugins.js';
import { registerCronRoutes } from './routes/cron.js';
import { registerMCPRoutes } from './routes/mcp.js';
import { registerObservabilityRoutes } from './routes/observability.js';
import { registerSkillRoutes } from './routes/skills.js';
import type { LongTermMemoryStore } from '../session/LongTermMemoryStore.js';
import type { AgentRoleService } from '../agent/roles/AgentRoleService.js';

const MAX_MESSAGE_LENGTH = CONSTANTS.MESSAGE_MAX_LENGTH;

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const packageVersion = packageJson.version;

export class APIServer {
  private app = express();
  private server = createServer(this.app);
  private log = logger.child('API');
  private port: number;
  private agentRuntime: AgentRuntime;
  private sessionManager: SessionManager;
  private sessionRouting: SessionRoutingService;
  private channelManager: ChannelManager;
  private config: Config;
  private pluginManager?: PluginManager;
  private cronService?: CronService;
  private mcpManager?: MCPClientManager;
  private skillManager?: SkillManager;
  private toolRegistry?: ToolRegistry;
  private longTermMemoryStore: LongTermMemoryStore;
  private agentRoleService?: AgentRoleService;

  constructor(options: {
    port: number;
    agentRuntime: AgentRuntime;
    sessionManager: SessionManager;
    sessionRouting: SessionRoutingService;
    channelManager: ChannelManager;
    config: Config;
    pluginManager?: PluginManager;
    cronService?: CronService;
    mcpManager?: MCPClientManager;
    skillManager?: SkillManager;
    toolRegistry?: ToolRegistry;
    longTermMemoryStore: LongTermMemoryStore;
    agentRoleService?: AgentRoleService;
  }) {
    this.port = options.port;
    this.agentRuntime = options.agentRuntime;
    this.sessionManager = options.sessionManager;
    this.sessionRouting = options.sessionRouting;
    this.channelManager = options.channelManager;
    this.config = options.config;
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

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.log.info(`API 服务已启动: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  private setupMiddleware(): void {
    const MAX_REQUEST_SIZE = 10 * 1024 * 1024;
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
      const expectedToken = this.config.server.token;

      if (typeof requestToken === 'string' && expectedToken && requestToken === expectedToken) {
        return next();
      }

      return res.status(401).json(createErrorResponse(new Error('Unauthorized: invalid or missing token')));
    });
  }

  private setupRoutes(): void {
    registerCoreRoutes(this.app, {
      agentRuntime: this.agentRuntime,
      sessionManager: this.sessionManager,
      sessionRouting: this.sessionRouting,
      agentRoleService: this.agentRoleService,
      channelManager: this.channelManager,
      getConfig: () => this.config,
      setConfig: (config) => {
        this.config = config;
      },
      toolRegistry: this.toolRegistry,
      packageVersion,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      log: this.log
    });
    registerMemoryRoutes(this.app, {
      sessionManager: this.sessionManager,
      longTermMemoryStore: this.longTermMemoryStore,
      log: this.log
    });
    registerSkillRoutes(this.app, this.skillManager);
    registerPluginRoutes(this.app, {
      pluginManager: this.pluginManager,
      setConfig: (config) => {
        this.config = config;
      }
    });
    registerCronRoutes(this.app, this.cronService);
    registerMCPRoutes(this.app, {
      toolRegistry: this.toolRegistry,
      getConfig: () => this.config,
      setConfig: (config) => {
        this.config = config;
      },
      getMcpManager: () => this.mcpManager,
      setMcpManager: (m) => { this.mcpManager = m; }
    });
    registerObservabilityRoutes(this.app, {
      setConfig: (config) => {
        this.config = config;
      }
    });
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
    this.config = config;
    this.log.info('配置已更新');
  }
}
