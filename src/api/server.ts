import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import { ConfigLoader } from '../config/loader.js';
import type { PluginManager } from '../plugins/index.js';
import { normalizeError, createErrorResponse, createValidationErrorResponse, NotFoundError } from '../utils/errors.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';
import { registerPluginRoutes } from './routes/plugins.js';
import { registerCronRoutes } from './routes/cron.js';
import { registerMCPRoutes } from './routes/mcp.js';
import { registerMetricsRoutes } from './routes/metrics.js';

const MAX_MESSAGE_LENGTH = CONSTANTS.MESSAGE_MAX_LENGTH;

let packageVersion = '0.1.0';
try {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
  packageVersion = packageJson.version || '0.1.0';
} catch {}

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
    private toolRegistry?: ToolRegistry
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
  }

  private setupRoutes(): void {
    // Core routes
    this.app.get('/api/status', (req, res) => {
      res.json({
        version: packageVersion,
        uptime: process.uptime(),
        channels: this.channelManager.getStatus(),
        sessions: this.sessionManager.count(),
        agentRunning: this.agent.isRunning()
      });
    });

    this.app.get('/api/sessions', (req, res) => {
      const sessions = this.sessionManager.list();
      res.json({ sessions: sessions.map(s => ({
        key: s.key, channel: s.channel, chatId: s.chatId,
        uuid: s.uuid, messageCount: s.messages.length
      })) });
    });

    this.app.get('/api/sessions/:key', async (req, res) => {
      const session = await this.sessionManager.getOrCreate(req.params.key);
      res.json({
        key: session.key, channel: session.channel, chatId: session.chatId,
        uuid: session.uuid, messageCount: session.messages.length, messages: session.messages
      });
    });

    this.app.delete('/api/sessions/:key', async (req, res) => {
      await this.sessionManager.delete(req.params.key);
      res.json({ success: true });
    });

    this.app.post('/api/chat', async (req, res) => {
      const { sessionKey, message } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json(createValidationErrorResponse('Message is required', 'message'));
      }
      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json(createValidationErrorResponse(`Message too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'message'));
      }

      const key = sessionKey || `api:${randomUUID()}`;
      try {
        const response = await this.agent.processDirect(message, key);
        res.json({ success: true, response });
      } catch (error: unknown) {
        this.log.error(`Chat error: ${normalizeError(error)}`);
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/channels', (req, res) => {
      res.json(this.channelManager.getStatus());
    });

    this.app.post('/api/channels/:name/send', async (req, res) => {
      const { chatId, content } = req.body;
      if (!chatId || typeof chatId !== 'string') {
        return res.status(400).json(createValidationErrorResponse('chatId is required and must be a string', 'chatId'));
      }
      if (!content || typeof content !== 'string') {
        return res.status(400).json(createValidationErrorResponse('content is required and must be a string', 'content'));
      }
      if (content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json(createValidationErrorResponse(`content too long (max ${MAX_MESSAGE_LENGTH} characters)`, 'content'));
      }

      const channel = this.channelManager.get(req.params.name);
      if (!channel) return res.status(404).json(createErrorResponse(new NotFoundError('Channel', req.params.name)));

      try {
        await channel.send({ channel: req.params.name, chatId, content });
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/tools', (req, res) => {
      res.json({ tools: this.toolRegistry?.getDefinitions() ?? [] });
    });

    this.app.get('/api/config', (req, res) => {
      res.json(this.config);
    });

    this.app.put('/api/config', async (req, res) => {
      try {
        const newConfig = req.body;
        await ConfigLoader.save(newConfig);
        this.config = newConfig;
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    // Skills
    if (this.skillManager) {
      const sm = this.skillManager;
      this.app.get('/api/skills', (req, res) => res.json({ skills: sm.listSkills() }));
      this.app.get('/api/skills/:name', (req, res) => {
        const skill = sm.getSkill(req.params.name);
        if (!skill) return res.status(404).json({ error: 'Skill not found' });
        res.json({ skill });
      });
      this.app.post('/api/skills/:name/toggle', async (req, res) => {
        const success = await sm.toggleSkill(req.params.name, req.body.enabled);
        if (!success) return res.status(404).json({ success: false, error: 'Skill not found' });
        res.json({ success: true });
      });
    }

    // Delegated route modules
    registerPluginRoutes(this.app, this.pluginManager);
    registerCronRoutes(this.app, this.cronService);
    registerMCPRoutes(this.app, {
      toolRegistry: this.toolRegistry,
      config: this.config,
      getMcpManager: () => this.mcpManager,
      setMcpManager: (m) => { this.mcpManager = m; }
    });
    registerMetricsRoutes(this.app);
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
