import express from 'express';
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import { ConfigService } from '../config/ConfigService.js';
import type { PluginManager } from '../plugins/index.js';
import { normalizeError, createErrorResponse, NotFoundError } from '../utils/errors.js';
import type { CronService } from '../cron/index.js';
import type { MCPClientManager } from '../mcp/MCPClient.js';
import type { SkillManager } from '../skills/SkillManager.js';
import { logger } from '../logger/index.js';
import { CONSTANTS } from '../constants/index.js';

const MAX_MESSAGE_LENGTH = CONSTANTS.MESSAGE_MAX_LENGTH;

export class APIServer {
  private app = express();
  private server = createServer(this.app);
  private log = logger.child({ prefix: 'API' });
  private configService = new ConfigService();

  constructor(
    private port: number,
    private agent: AgentLoop,
    private sessionManager: SessionManager,
    private channelManager: ChannelManager,
    private config: Config,
    private pluginManager?: PluginManager,
    private cronService?: CronService,
    private mcpManager?: MCPClientManager,
    private skillManager?: SkillManager
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
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });
  }

  private setupRoutes(): void {
    this.app.get('/api/status', (req, res) => {
      res.json({
        version: '0.1.0',
        uptime: process.uptime(),
        channels: this.channelManager.getStatus(),
        sessions: this.sessionManager.count(),
        agentRunning: this.agent.isRunning()
      });
    });

    this.app.get('/api/sessions', (req, res) => {
      const sessions = this.sessionManager.list();
      res.json({ sessions: sessions.map(s => ({
        key: s.key,
        channel: s.channel,
        chatId: s.chatId,
        uuid: s.uuid,
        messageCount: s.messages.length
      })) });
    });

    this.app.get('/api/sessions/:key', async (req, res) => {
      const session = await this.sessionManager.getOrCreate(req.params.key);
      res.json({
        key: session.key,
        channel: session.channel,
        chatId: session.chatId,
        uuid: session.uuid,
        messageCount: session.messages.length,
        messages: session.messages
      });
    });

    this.app.delete('/api/sessions/:key', async (req, res) => {
      await this.sessionManager.delete(req.params.key);
      res.json({ success: true });
    });

    this.app.post('/api/chat', async (req, res) => {
      const { sessionKey, message } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }

      if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      const key = sessionKey || `api:${Date.now()}`;

      this.log.debug(`POST /api/chat - session: ${key}, message: ${message.substring(0, 50)}...`);

      try {
        const response = await this.agent.processDirect(message, key);
        this.log.debug(`Chat response: ${response.substring(0, 50)}...`);
        res.json({ success: true, response });
      } catch (error: unknown) {
        const message = normalizeError(error);
        this.log.error(`Chat error: ${message}`);
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/channels', (req, res) => {
      res.json(this.channelManager.getStatus());
    });

    this.app.post('/api/channels/:name/send', async (req, res) => {
      const { chatId, content } = req.body;

      if (!chatId || typeof chatId !== 'string') {
        return res.status(400).json({ error: 'chatId is required and must be a string' });
      }

      if (!content || typeof content !== 'string') {
        return res.status(400).json({ error: 'content is required and must be a string' });
      }

      if (content.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ error: `content too long (max ${MAX_MESSAGE_LENGTH} characters)` });
      }

      const channel = this.channelManager.get(req.params.name);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      try {
        await channel.send({ channel: req.params.name, chatId, content });
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/tools', (req, res) => {
      const tools = this.agent.getToolDefinitions();
      res.json({ tools });
    });

    this.app.get('/api/plugins', async (req, res) => {
      if (!this.pluginManager) {
        return res.json({ plugins: [] });
      }
      const plugins = await this.pluginManager.getAllPlugins();
      res.json({ plugins });
    });

    this.app.post('/api/plugins/:name/toggle', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      try {
        const { enabled } = req.body;
        const { name } = req.params;

        const success = await this.pluginManager.enablePlugin(name, enabled);
        if (success) {
          await this.configService.updatePluginConfig(name, enabled);
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: 'Failed to toggle plugin' });
        }
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.post('/api/plugins/:name/reload', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      const { name } = req.params;

      const success = await this.pluginManager.reloadPlugin(name);
      if (success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: 'Failed to reload plugin' });
      }
    });

    this.app.put('/api/plugins/:name/config', async (req, res) => {
      if (!this.pluginManager) {
        return res.status(500).json({ success: false, error: 'Plugin manager not available' });
      }
      try {
        const { options } = req.body;
        const { name } = req.params;

        const success = await this.pluginManager.updatePluginConfig(name, options);
        if (success) {
          const config = this.configService.get();
          const currentEnabled = config.plugins?.[name]?.enabled ?? true;
          await this.configService.updatePluginConfig(name, currentEnabled, options);
          res.json({ success: true });
        } else {
          res.status(500).json({ success: false, error: 'Failed to update plugin config' });
        }
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });

    this.app.get('/api/config', (req, res) => {
      res.json(this.config);
    });

    this.app.put('/api/config', async (req, res) => {
      try {
        const newConfig = req.body;
        await this.configService.save(newConfig);
        this.config = newConfig;
        res.json({ success: true });
      } catch (error: unknown) {
        res.status(500).json(createErrorResponse(error));
      }
    });


    // MCP routes
    if (this.mcpManager) {
      this.app.get('/api/mcp', (req, res) => {
        const tools = this.mcpManager!.getTools();
        res.json({
          servers: this.mcpManager!.getServerNames(),
          tools: tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        });
      });

      this.app.get('/api/mcp/tools', (req, res) => {
        const tools = this.mcpManager!.getTools();
        res.json({ tools });
      });
    }

    // Skills routes
    if (this.skillManager) {
      this.app.get('/api/skills', (req, res) => {
        const skills = this.skillManager!.listSkills();
        res.json({ skills });
      });

      this.app.get('/api/skills/:name', (req, res) => {
        const skill = this.skillManager!.getSkill(req.params.name);
        if (!skill) {
          return res.status(404).json({ error: 'Skill not found' });
        }
        res.json({ skill });
      });

      this.app.post('/api/skills/:name/toggle', async (req, res) => {
        const { enabled } = req.body;
        const { name } = req.params;
        const success = await this.skillManager!.toggleSkill(name, enabled);
        if (!success) {
          return res.status(404).json({ success: false, error: 'Skill not found' });
        }
        res.json({ success: true });
      });
    }

    if (this.cronService) {
      const cronService = this.cronService;

      this.app.get('/api/cron', (req, res) => {
        const jobs = cronService.listJobs();
        res.json({ jobs });
      });

      this.app.get('/api/cron/:id', (req, res) => {
        const job = cronService.getJob(req.params.id);
        if (!job) {
          return res.status(404).json({ error: 'Job not found' });
        }
        res.json({ job });
      });

      this.app.post('/api/cron', (req, res) => {
        const { name, schedule, payload, enabled } = req.body;

        if (!name || !schedule || !payload) {
          return res.status(400).json({ success: false, error: 'name, schedule, and payload are required' });
        }

        if (!['once', 'interval', 'daily', 'cron'].includes(schedule.kind)) {
          return res.status(400).json({ success: false, error: 'Invalid schedule kind' });
        }

        const job = cronService.addJob({
          id: randomUUID().slice(0, 8),
          name,
          enabled: enabled !== false,
          schedule,
          payload
        });

        res.json({ success: true, job });
      });

      this.app.put('/api/cron/:id', (req, res) => {
        const { name, schedule, payload, enabled } = req.body;
        const existing = cronService.getJob(req.params.id);

        if (!existing) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }

        if (name !== undefined) existing.name = name;
        if (schedule !== undefined) existing.schedule = schedule;
        if (payload !== undefined) existing.payload = payload;
        if (enabled !== undefined) existing.enabled = enabled;

        cronService.computeNextRun(existing);
        cronService.removeJob(req.params.id);
        cronService.addJob(existing);

        res.json({ success: true, job: existing });
      });

      this.app.delete('/api/cron/:id', (req, res) => {
        const removed = cronService.removeJob(req.params.id);
        if (!removed) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }
        res.json({ success: true });
      });

      this.app.post('/api/cron/:id/toggle', (req, res) => {
        const { enabled } = req.body;
        const job = cronService.getJob(req.params.id);

        if (!job) {
          return res.status(404).json({ success: false, error: 'Job not found' });
        }

        cronService.enableJob(req.params.id, enabled);
        res.json({ success: true, enabled });
      });
    }
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
