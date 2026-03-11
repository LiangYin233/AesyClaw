import { randomUUID } from 'crypto';
import type { Express } from 'express';
import type { AgentLoop } from '../../agent/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { createErrorResponse, createValidationErrorResponse, normalizeError, NotFoundError } from '../../logger/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';

interface CoreRouteDeps {
  agent: AgentLoop;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  toolRegistry?: ToolRegistry;
  packageVersion: string;
  maxMessageLength: number;
  log: {
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  };
}

export function registerCoreRoutes(app: Express, deps: CoreRouteDeps): void {
  app.get('/api/status', (req, res) => {
    res.json({
      version: deps.packageVersion,
      uptime: process.uptime(),
      channels: deps.channelManager.getStatus(),
      sessions: deps.sessionManager.count(),
      agentRunning: deps.agent.isRunning()
    });
  });

  app.get('/api/sessions', (req, res) => {
    const sessions = deps.sessionManager.list();
    res.json({
      sessions: sessions.map((session) => ({
        key: session.key,
        channel: session.channel,
        chatId: session.chatId,
        uuid: session.uuid,
        messageCount: session.messages.length
      }))
    });
  });

  app.get('/api/sessions/:key', async (req, res) => {
    const session = await deps.sessionManager.getOrCreate(req.params.key);
    res.json({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      messageCount: session.messages.length,
      messages: session.messages
    });
  });

  app.delete('/api/sessions/:key', async (req, res) => {
    await deps.sessionManager.delete(req.params.key);
    res.json({ success: true });
  });

  app.post('/api/chat', async (req, res) => {
    const { sessionKey, message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json(createValidationErrorResponse('Message is required', 'message'));
    }
    if (message.length > deps.maxMessageLength) {
      return res.status(400).json(
        createValidationErrorResponse(`Message too long (max ${deps.maxMessageLength} characters)`, 'message')
      );
    }

    const key = sessionKey || `api:${randomUUID()}`;
    try {
      deps.log.info(`Processing API chat request, session: ${key}`);
      const response = await deps.agent.processDirect(message, key);
      res.json({ success: true, response });
    } catch (error: unknown) {
      deps.log.error(`Chat error: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/channels', (req, res) => {
    res.json(deps.channelManager.getStatus());
  });

  app.post('/api/channels/:name/send', async (req, res) => {
    const { chatId, content } = req.body;
    if (!chatId || typeof chatId !== 'string') {
      return res.status(400).json(createValidationErrorResponse('chatId is required and must be a string', 'chatId'));
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json(createValidationErrorResponse('content is required and must be a string', 'content'));
    }
    if (content.length > deps.maxMessageLength) {
      return res.status(400).json(
        createValidationErrorResponse(`content too long (max ${deps.maxMessageLength} characters)`, 'content')
      );
    }

    const channel = deps.channelManager.get(req.params.name);
    if (!channel) {
      return res.status(404).json(createErrorResponse(new NotFoundError('Channel', req.params.name)));
    }

    try {
      deps.log.info(`Sending message via API to ${req.params.name}:${chatId}`);
      await channel.send({ channel: req.params.name, chatId, content });
      res.json({ success: true });
    } catch (error: unknown) {
      deps.log.error(`Failed to send message via API to ${req.params.name}:${chatId}:`, error);
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/tools', (req, res) => {
    res.json({ tools: deps.toolRegistry?.getDefinitions() ?? [] });
  });

  app.get('/api/config', (req, res) => {
    res.json(deps.getConfig());
  });

  app.put('/api/config', async (req, res) => {
    try {
      const newConfig = req.body;
      deps.log.info('Updating config via API');
      await ConfigLoader.save(newConfig);
      deps.setConfig(newConfig);
      res.json({ success: true });
    } catch (error: unknown) {
      deps.log.error('Failed to update config via API:', error);
      res.status(500).json(createErrorResponse(error));
    }
  });
}
