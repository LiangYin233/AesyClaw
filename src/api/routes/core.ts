import { randomUUID } from 'crypto';
import type { Express } from 'express';
import type { AgentLoop } from '../../agent/index.js';
import { ConfigLoader } from '../../config/loader.js';
import { INTERNAL_CHANNELS } from '../../constants/index.js';
import { createErrorResponse, createValidationErrorResponse, normalizeError, NotFoundError } from '../../logger/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { AgentRoleService } from '../../agent/roles/AgentRoleService.js';
import type { AgentRoleConfig, Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';

interface CoreRouteDeps {
  agent: AgentLoop;
  sessionManager: SessionManager;
  channelManager: ChannelManager;
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  toolRegistry?: ToolRegistry;
  agentRoleService?: AgentRoleService;
  packageVersion: string;
  maxMessageLength: number;
  log: {
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  };
}

function parseAgentRoleInput(body: any, nameFromPath?: string): AgentRoleConfig {
  if (!body || typeof body !== 'object') {
    throw new Error('Agent role payload must be an object');
  }

  const name = String(nameFromPath || body.name || '').trim();
  const provider = String(body.provider || '').trim();
  const model = String(body.model || '').trim();
  const systemPrompt = String(body.systemPrompt || '').trim();
  const description = String(body.description || '').trim();
  const allowedSkills = Array.isArray(body.allowedSkills)
    ? body.allowedSkills.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  const allowedTools = Array.isArray(body.allowedTools)
    ? body.allowedTools.filter((item: unknown): item is string => typeof item === 'string')
    : [];

  if (!name) {
    throw new Error('name is required');
  }
  if (!provider) {
    throw new Error('provider is required');
  }
  if (!model) {
    throw new Error('model is required');
  }
  if (!systemPrompt) {
    throw new Error('systemPrompt is required');
  }

  return {
    name,
    description,
    systemPrompt,
    provider,
    model,
    allowedSkills,
    allowedTools
  };
}

export function registerCoreRoutes(app: Express, deps: CoreRouteDeps): void {
  const getChannelStatus = () => ({
    ...deps.channelManager.getStatus(),
    [INTERNAL_CHANNELS.WEBUI]: {
      running: true,
      enabled: true,
      connected: true
    }
  });

  const getDefaultRoleName = () => deps.agentRoleService?.getDefaultRoleName() || 'main';

  app.get('/api/status', (req, res) => {
    res.json({
      version: deps.packageVersion,
      uptime: process.uptime(),
      channels: getChannelStatus(),
      sessions: deps.sessionManager.count(),
      agentRunning: deps.agent.isRunning()
    });
  });

  app.get('/api/sessions', async (req, res) => {
    const sessions = deps.sessionManager.list();
    const payload = await Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: session.agentName || await deps.sessionManager.getSessionAgent(session.key) || getDefaultRoleName(),
      messageCount: session.messages.length
    })));

    res.json({ sessions: payload });
  });

  app.get('/api/sessions/:key', async (req, res) => {
    const session = await deps.sessionManager.getOrCreate(req.params.key);
    res.json({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: session.agentName || await deps.sessionManager.getSessionAgent(session.key) || getDefaultRoleName(),
      messageCount: session.messages.length,
      messages: session.messages
    });
  });

  app.put('/api/sessions/:key/agent', async (req, res) => {
    try {
      if (!deps.agentRoleService) {
        return res.status(503).json(createErrorResponse(new Error('Agent role service unavailable')));
      }

      const { agentName } = req.body;
      if (agentName !== null && agentName !== undefined && typeof agentName !== 'string') {
        return res.status(400).json(createValidationErrorResponse('agentName must be a string or null', 'agentName'));
      }

      const key = req.params.key;
      if (agentName === null || agentName === '') {
        await deps.sessionManager.clearSessionAgent(key);
        return res.json({ success: true, agentName: getDefaultRoleName() });
      }

      const role = deps.agentRoleService.getResolvedRole(agentName);
      if (!role) {
        return res.status(404).json(createErrorResponse(new NotFoundError('Agent role', agentName)));
      }

      await deps.sessionManager.setSessionAgent(key, role.name);
      res.json({ success: true, agentName: role.name });
    } catch (error: unknown) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/sessions/:key', async (req, res) => {
    await deps.sessionManager.delete(req.params.key);
    res.json({ success: true });
  });

  app.get('/api/agents', async (req, res) => {
    if (!deps.agentRoleService) {
      return res.json({ agents: [] });
    }

    res.json({ agents: deps.agentRoleService.listResolvedRoles() });
  });

  app.post('/api/agents', async (req, res) => {
    try {
      if (!deps.agentRoleService) {
        return res.status(503).json(createErrorResponse(new Error('Agent role service unavailable')));
      }

      const role = await deps.agentRoleService.createRole(parseAgentRoleInput(req.body));
      res.status(201).json({ agent: role });
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  });

  app.put('/api/agents/:name', async (req, res) => {
    try {
      if (!deps.agentRoleService) {
        return res.status(503).json(createErrorResponse(new Error('Agent role service unavailable')));
      }

      const role = await deps.agentRoleService.updateRole(req.params.name, parseAgentRoleInput(req.body, req.params.name));
      res.json({ agent: role });
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  });

  app.delete('/api/agents/:name', async (req, res) => {
    try {
      if (!deps.agentRoleService) {
        return res.status(503).json(createErrorResponse(new Error('Agent role service unavailable')));
      }

      await deps.agentRoleService.deleteRole(req.params.name);
      await deps.sessionManager.deleteAgentBindings(req.params.name);
      res.json({ success: true });
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  });

  app.post('/api/chat', async (req, res) => {
    const { sessionKey, message, channel, chatId } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json(createValidationErrorResponse('Message is required', 'message'));
    }
    if (channel !== undefined && typeof channel !== 'string') {
      return res.status(400).json(createValidationErrorResponse('channel must be a string', 'channel'));
    }
    if (chatId !== undefined && typeof chatId !== 'string') {
      return res.status(400).json(createValidationErrorResponse('chatId must be a string', 'chatId'));
    }
    if (message.length > deps.maxMessageLength) {
      return res.status(400).json(
        createValidationErrorResponse(`Message too long (max ${deps.maxMessageLength} characters)`, 'message')
      );
    }

    const resolvedChannel = channel?.trim() || INTERNAL_CHANNELS.WEBUI;
    const key = sessionKey || `${resolvedChannel}:${randomUUID()}`;
    const resolvedChatId = chatId?.trim() || sessionKey || key;

    try {
      if (message.trim() === '/stop') {
        const aborted = deps.agent.abortSession(resolvedChannel, resolvedChatId);

        return res.json({
          success: true,
          response: aborted ? '已停止当前聊天中的运行任务。' : '当前聊天没有正在运行的任务。'
        });
      }

      deps.log.info(`Processing API chat request, session: ${key}`);
      const response = await deps.agent.processDirect(message, key, {
        channel: resolvedChannel,
        chatId: resolvedChatId,
        messageType: 'private'
      });
      res.json({ success: true, response });
    } catch (error: unknown) {
      deps.log.error(`Chat error: ${normalizeError(error)}`);
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.get('/api/channels', (req, res) => {
    res.json(getChannelStatus());
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

    const channelInstance = deps.channelManager.get(req.params.name);
    if (!channelInstance) {
      return res.status(404).json(createErrorResponse(new NotFoundError('Channel', req.params.name)));
    }

    try {
      deps.log.info(`Sending message via API to ${req.params.name}:${chatId}`);
      await channelInstance.send({ channel: req.params.name, chatId, content });
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
