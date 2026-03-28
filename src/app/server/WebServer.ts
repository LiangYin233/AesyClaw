import { createServer, type IncomingMessage, type ServerResponse } from 'http';
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
import { logger } from '../../platform/observability/index.js';
import type { LongTermMemoryStore } from '../../features/sessions/infrastructure/LongTermMemoryStore.js';
import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { EventBus } from '../../platform/events/EventBus.js';
import type { AesyClawEvents } from '../../platform/events/events.js';
import { WebSocketApiServer } from '../ws/WebSocketApiServer.js';
import { registerWebSocketHandlers } from '../../features/registerWebSocketHandlers.js';

const MAX_MESSAGE_LENGTH = 50000;

const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
const packageVersion = packageJson.version;

export class WebServer {
  private server = createServer((req, res) => {
    this.handleRequest(req, res);
  });
  private log = logger.child('WebServer');
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
  private eventBus: EventBus<AesyClawEvents>;
  private wsApiServer?: WebSocketApiServer;
  private wsCleanup?: () => void;

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
    eventBus: EventBus<AesyClawEvents>;
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
    this.eventBus = options.eventBus;
  }

  async start(): Promise<void> {
    this.setupWebSocketServer();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.wsCleanup?.();
    this.wsCleanup = undefined;

    if (this.wsApiServer) {
      await this.wsApiServer.close();
      this.wsApiServer = undefined;
    }

    return new Promise((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  updateConfig(config: Config): void {
    this.configStore.setConfig(config);
  }

  setMcpManager(manager: McpClientManager | undefined): void {
    this.mcpManager = manager;
  }

  private setupWebSocketServer(): void {
    this.wsApiServer = new WebSocketApiServer({
      server: this.server,
      path: '/ws',
      getExpectedToken: () => this.configStore.getConfig().server.token,
      log: logger.child('WebSocket')
    });

    this.wsCleanup = registerWebSocketHandlers({
      server: this.wsApiServer,
      packageVersion,
      maxMessageLength: MAX_MESSAGE_LENGTH,
      agentRuntime: this.agentRuntime,
      db: this.db,
      sessionManager: this.sessionManager,
      sessionRouting: this.sessionRouting,
      agentRoleService: this.agentRoleService,
      channelManager: this.channelManager,
      configStore: this.configStore,
      configManager: this.configManager,
      toolRegistry: this.toolRegistry,
      longTermMemoryStore: this.longTermMemoryStore,
      pluginManager: this.pluginManager,
      cronService: this.cronService,
      getMcpManager: () => this.mcpManager,
      setMcpManager: (manager) => {
        this.mcpManager = manager;
      },
      skillManager: this.skillManager,
      eventBus: this.eventBus
    });
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({
      success: false,
      error: 'Not Found'
    }));
  }
}
