import express from 'express';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentLoop } from '../agent/core/AgentLoop.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import type { PluginManager } from '../plugins/index.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { logger, createErrorResponse } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONSTANTS } from '../constants/index.js';
import { registerCoreRoutes } from './routes/core.js';
import { registerMemoryRoutes } from './routes/memory.js';
import { registerPluginRoutes } from './routes/plugins.js';
import { registerCronRoutes } from './routes/cron.js';
import { registerMCPRoutes } from './routes/mcp.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { registerSkillRoutes } from './routes/skills.js';
import type { MemoryFactStore } from '../session/MemoryFactStore.js';
import type { AgentRoleService as RuntimeAgentRoleService } from '../agent/roles/AgentRoleService.js';
import { ChatService } from './services/ChatService.js';
import { SessionService } from './services/SessionService.js';
import { AgentRoleService } from './services/AgentRoleService.js';

const MAX_MESSAGE_LENGTH = CONSTANTS.MESSAGE_MAX_LENGTH;

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const packageVersion = packageJson.version;

export class APIServer {
  private app = express();
  private server = createServer(this.app);
  private log = logger.child({ prefix: 'API' });

  constructor(
    private port: number,
    private agent: AgentLoop,
    private sessionManager: SessionManager,
    private channelManager: ChannelManager,
    private config: Config,
    private pluginManager?: PluginManager,
    private cronService?: CronService,
    private mcpManager?: MCPClientManager,
    private skillManager?: SkillManager,
    private toolRegistry?: ToolRegistry,
    private memoryFactStore?: MemoryFactStore,
    private agentRoleService?: RuntimeAgentRoleService
  ) {}

  async start(): Promise<void> {
    this.setupMiddleware();
    this.setupRoutes();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.log.info(`Server started on http://localhost:${this.port}`);
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

    this.app.use((req, res, next) => {
      const endTimer = metrics.timer('api.request_time', {
        method: req.method,
        path: req.path
      });
      res.on('finish', () => {
        endTimer();
      });
      next();
    });
  }

  private setupRoutes(): void {
    const chatService = new ChatService(this.agent);
    const sessionService = new SessionService(this.sessionManager, this.agentRoleService);
    const agentRoleAppService = this.agentRoleService
      ? new AgentRoleService(this.agentRoleService, this.sessionManager)
      : undefined;

    registerCoreRoutes(this.app, {
      chatService,
      sessionService,
      agentRoleService: agentRoleAppService,
      channelManager: this.channelManager,
      getConfig: () => this.config,
      setConfig: (config) => {
        this.config = config;
      },
      toolRegistry: this.toolRegistry,
      packageVersion,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      sessionCount: () => this.sessionManager.count(),
      agentRunning: () => this.agent.isRunning(),
      log: this.log
    });
    registerMemoryRoutes(this.app, {
      sessionManager: this.sessionManager,
      memoryFactStore: this.memoryFactStore,
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
    registerMetricsRoutes(this.app, {
      setConfig: (config) => {
        this.config = config;
      }
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.log.info('Server stopped');
        resolve();
      });
    });
  }

  updateConfig(config: Config): void {
    this.config = config;
    this.log.info('Config updated');
  }
}
