import express from 'express';
import { createServer } from 'http';
import type { AgentLoop } from '../agent/AgentLoop.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { ChannelManager } from '../channels/ChannelManager.js';
import type { Config } from '../types.js';
import { ConfigLoader } from '../config/loader.js';
import type { PluginManager } from '../plugins/index.js';
import { logger } from '../logger/index.js';

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
    private pluginManager?: PluginManager
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
      const MAX_MESSAGE_LENGTH = 50000;
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
      } catch (error: any) {
        this.log.error(`Chat error: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
      }
    });

    this.app.get('/api/channels', (req, res) => {
      res.json(this.channelManager.getStatus());
    });

    this.app.post('/api/channels/:name/send', async (req, res) => {
      const { chatId, content } = req.body;
      const channel = this.channelManager.get(req.params.name);

      if (!channel) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      try {
        await channel.send({ channel: req.params.name, chatId, content });
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/tools', (req, res) => {
      const tools = this.agent.getToolDefinitions();
      res.json({ tools });
    });

    this.app.get('/api/plugins', (req, res) => {
      if (!this.pluginManager) {
        return res.json({ plugins: [] });
      }
      const plugins = this.pluginManager.listPlugins();
      res.json({ 
        plugins: plugins.map(p => ({
          name: p.name,
          version: p.version,
          description: p.description,
          toolsCount: p.tools?.length || 0
        }))
      });
    });

    this.app.get('/api/config', (req, res) => {
      const safeConfig = this.sanitizeConfig(this.config);
      res.json(safeConfig);
    });

    this.app.put('/api/config', async (req, res) => {
      try {
        const newConfig = req.body;
        await ConfigLoader.save(newConfig);
        this.config = newConfig;
        res.json({ success: true });
      } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }

  private sanitizeConfig(config: Config): any {
    const safe: any = { ...config };
    if (safe.providers) {
      for (const key of Object.keys(safe.providers)) {
        if (safe.providers[key]?.apiKey) {
          safe.providers[key].apiKey = '***';
        }
      }
    }
    return safe;
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
