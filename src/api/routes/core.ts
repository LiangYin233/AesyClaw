import type { Express } from 'express';
import { ConfigLoader } from '../../config/loader.js';
import { getConfigValidationIssue } from '../../config/index.js';
import { INTERNAL_CHANNELS } from '../../constants/index.js';
import { createErrorResponse, createValidationErrorResponse, normalizeError, NotFoundError, ValidationError } from '../../errors/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { ChatService } from '../services/ChatService.js';
import type { SessionService } from '../services/SessionService.js';
import type { AgentRoleService } from '../services/AgentRoleService.js';
import { parseAgentRoleInput } from '../mappers/agentRoleMapper.js';
import { SessionManager } from '../../session/SessionManager.js';
import { badRequest, notFound, serverError, unavailable, wrap } from './helpers.js';

interface CoreRouteDeps {
  chatService: ChatService;
  sessionService: SessionService;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  getConfig: () => Config;
  setConfig: (config: Config) => void;
  toolRegistry?: ToolRegistry;
  packageVersion: string;
  maxMessageLength: number;
  sessionCount: () => number;
  agentRunning: () => boolean;
  log: {
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  };
}

export function registerCoreRoutes(app: Express, deps: CoreRouteDeps): void {
  const getChannelStatus = () => {
    const runtimeStatus = deps.channelManager.getStatus();
    const configuredChannels = deps.getConfig().channels;
    const merged: Record<string, { running?: boolean; enabled?: boolean; connected?: boolean }> = {};

    for (const [name, config] of Object.entries(configuredChannels)) {
      const status = runtimeStatus[name];
      const running = status?.running ?? false;
      merged[name] = {
        running,
        enabled: Boolean((config as Record<string, unknown>)?.enabled),
        connected: running
      };
    }

    for (const [name, status] of Object.entries(runtimeStatus)) {
      merged[name] = {
        enabled: merged[name]?.enabled ?? true,
        running: status.running,
        connected: status.running
      };
    }

    merged[INTERNAL_CHANNELS.WEBUI] = {
      running: true,
      enabled: true,
      connected: true
    };

    return merged;
  };

  app.get('/api/status', (req, res) => {
    res.json({
      version: deps.packageVersion,
      uptime: process.uptime(),
      channels: getChannelStatus(),
      sessions: deps.sessionCount(),
      agentRunning: deps.agentRunning()
    });
  });

  app.get('/api/sessions', async (req, res) => {
    res.json({ sessions: await deps.sessionService.listSessions() });
  });

  app.get('/api/sessions/:key', async (req, res) => {
    try {
      SessionManager.validateSessionKey(req.params.key);
      res.json(await deps.sessionService.getSessionDetails(req.params.key));
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return badRequest(res, error.message, 'key');
      }
      if (error instanceof NotFoundError) {
        return res.status(404).json(createErrorResponse(error));
      }
      serverError(res, error);
    }
  });

  app.put('/api/sessions/:key/agent', async (req, res) => {
    try {
      SessionManager.validateSessionKey(req.params.key);
      const { agentName } = req.body;
      if (agentName !== null && agentName !== undefined && typeof agentName !== 'string') {
        return badRequest(res, 'agentName must be a string or null', 'agentName');
      }

      res.json(await deps.sessionService.setSessionAgent(req.params.key, agentName ?? null));
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return badRequest(res, error.message, 'key');
      }
      if (error instanceof NotFoundError) {
        return res.status(404).json(createErrorResponse(error));
      }
      serverError(res, error);
    }
  });

  app.delete('/api/sessions/:key', async (req, res) => {
    try {
      SessionManager.validateSessionKey(req.params.key);
      res.json(await deps.sessionService.deleteSession(req.params.key));
    } catch (error: unknown) {
      if (error instanceof ValidationError) {
        return badRequest(res, error.message, 'key');
      }
      serverError(res, error);
    }
  });

  app.get('/api/agents', async (req, res) => {
    if (!deps.agentRoleService) {
      return res.json({ agents: [] });
    }

    res.json(await deps.agentRoleService.listAgents());
  });

  app.post('/api/agents', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      res.status(201).json(await deps.agentRoleService.createAgent(parseAgentRoleInput(req.body)));
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  }));

  app.put('/api/agents/:name', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      const name = String(req.params.name);
      res.json(await deps.agentRoleService.updateAgent(name, parseAgentRoleInput(req.body, name)));
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  }));

  app.delete('/api/agents/:name', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      res.json(await deps.agentRoleService.deleteAgent(String(req.params.name)));
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  }));

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

    try {
      deps.log.info('收到 API 对话请求', { sessionKey: sessionKey || 'auto', channel, chatId });
      const response = await deps.chatService.handleChat({ sessionKey, message, channel, chatId });
      res.json(response);
    } catch (error: unknown) {
      deps.log.error(`对话请求失败: ${normalizeError(error)}`);
      serverError(res, error);
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
      return notFound(res, 'Channel', req.params.name);
    }

    try {
      deps.log.info('收到 API 外发消息请求', { channel: req.params.name, chatId });
      await channelInstance.send({ channel: req.params.name, chatId, content });
      res.json({ success: true });
    } catch (error: unknown) {
      deps.log.error('API 外发消息失败', { channel: req.params.name, chatId, error: normalizeError(error) });
      serverError(res, error);
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
      if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
        return badRequest(res, 'config body must be an object', 'config');
      }
      deps.log.info('收到 API 配置更新请求');
      const savedConfig = await ConfigLoader.update(() => newConfig as Config);
      deps.setConfig(savedConfig);
      res.json({ success: true });
    } catch (error: unknown) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        return badRequest(res, issue.message, issue.field);
      }

      deps.log.error('API 配置更新失败', { error: normalizeError(error) });
      serverError(res, error);
    }
  });
}
