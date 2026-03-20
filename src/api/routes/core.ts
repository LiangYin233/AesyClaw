import type { Express } from 'express';
import { randomUUID } from 'crypto';
import { getConfigValidationIssue } from '../../config/index.js';
import { createErrorResponse, createValidationErrorResponse, normalizeApiError } from '../errors.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import { parseAgentRoleInput } from '../mappers/agentRoleMapper.js';
import { SessionManager } from '../../session/SessionManager.js';
import { SessionNotFoundError, SessionValidationError } from '../../session/errors.js';
import type { SessionRoutingService } from '../../agent/core-session/SessionRoutingService.js';
import type { AgentRoleService } from '../../agent/core-roles/AgentRoleService.js';
import { AgentRoleNotFoundError } from '../../agent/core-roles/errors.js';
import type { AgentRuntime } from '../../agent/index.js';
import { assignSessionAgent } from '../../agent/core-usecases/index.js';
import { badRequest, notFound, serverError, unavailable, wrap } from './helpers.js';

const WEBUI_CHANNEL = 'webui';

interface CoreRouteDeps {
  agentRuntime: Pick<AgentRuntime, 'handleDirect' | 'isRunning'>;
  sessionManager: SessionManager;
  sessionRouting: SessionRoutingService;
  agentRoleService?: AgentRoleService;
  channelManager: ChannelManager;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  toolRegistry?: ToolRegistry;
  packageVersion: string;
  maxMessageLength: number;
  log: {
    info(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;
  };
}

export function registerCoreRoutes(app: Express, deps: CoreRouteDeps): void {
  const getDefaultRoleName = () => deps.agentRoleService?.getDefaultRoleName() || 'main';

  const listSessions = async () => {
    const sessions = deps.sessionManager.list();
    return Promise.all(sessions.map(async (session) => ({
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: deps.sessionRouting.getConversationAgent(session.channel, session.chatId) || getDefaultRoleName(),
      messageCount: session.messages.length
    })));
  };

  const getSessionDetails = async (key: string) => {
    const session = await deps.sessionManager.getExistingOrThrow(key);
    return {
      key: session.key,
      channel: session.channel,
      chatId: session.chatId,
      uuid: session.uuid,
      agentName: deps.sessionRouting.getConversationAgent(session.channel, session.chatId) || getDefaultRoleName(),
      messageCount: session.messages.length,
      messages: session.messages
    };
  };

  const setSessionAgent = async (key: string, agentName: string | null): Promise<{ success: true; agentName: string }> => {
    if (!deps.agentRoleService) {
      throw new Error('Agent role service unavailable');
    }

    return assignSessionAgent({
      getDefaultRoleName,
      getSession: async (sessionKey) => deps.sessionManager.getExistingOrThrow(sessionKey),
      getResolvedRole: (name) => deps.agentRoleService!.getResolvedRole(name),
      clearConversationAgent: (channel, chatId) => deps.sessionRouting.clearConversationAgent(channel, chatId),
      setConversationAgent: (channel, chatId, resolvedAgentName) => {
        deps.sessionRouting.setConversationAgent(channel, chatId, resolvedAgentName);
      }
    }, {
      sessionKey: key,
      agentName
    });
  };

  const deleteSession = async (key: string): Promise<{ success: true }> => {
    await deps.sessionManager.delete(key);
    return { success: true };
  };

  const createChatResponse = async (request: {
    sessionKey?: string;
    message: string;
    channel?: string;
    chatId?: string;
  }) => {
    const resolvedChannel = request.channel?.trim() || WEBUI_CHANNEL;
    const key = request.sessionKey || `${resolvedChannel}:${randomUUID()}`;
    const resolvedChatId = request.chatId?.trim() || request.sessionKey || key;
    const response = await deps.agentRuntime.handleDirect(request.message, {
      sessionKey: key,
      channel: resolvedChannel,
      chatId: resolvedChatId,
      messageType: 'private'
    });

    return {
      success: true as const,
      response
    };
  };

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

    merged[WEBUI_CHANNEL] = {
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
      sessions: deps.sessionManager.count(),
      agentRunning: deps.agentRuntime.isRunning()
    });
  });

  app.get('/api/sessions', async (req, res) => {
    res.json({ sessions: await listSessions() });
  });

  app.get('/api/sessions/:key', async (req, res) => {
    try {
      SessionManager.validateSessionKey(req.params.key);
      res.json(await getSessionDetails(req.params.key));
    } catch (error: unknown) {
      if (error instanceof SessionValidationError) {
        return badRequest(res, error.message, 'key');
      }
      if (error instanceof SessionNotFoundError) {
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

      res.json(await setSessionAgent(req.params.key, agentName ?? null));
    } catch (error: unknown) {
      if (error instanceof SessionValidationError) {
        return badRequest(res, error.message, 'key');
      }
      if (error instanceof SessionNotFoundError || error instanceof AgentRoleNotFoundError) {
        return res.status(404).json(createErrorResponse(error));
      }
      serverError(res, error);
    }
  });

  app.delete('/api/sessions/:key', async (req, res) => {
    try {
      SessionManager.validateSessionKey(req.params.key);
      res.json(await deleteSession(req.params.key));
    } catch (error: unknown) {
      if (error instanceof SessionValidationError) {
        return badRequest(res, error.message, 'key');
      }
      serverError(res, error);
    }
  });

  app.get('/api/agents', async (req, res) => {
    if (!deps.agentRoleService) {
      return res.json({ agents: [] });
    }

    res.json({ agents: deps.agentRoleService.listResolvedRoles() });
  });

  app.post('/api/agents', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      const agent = await deps.agentRoleService.createRole(parseAgentRoleInput(req.body));
      res.status(201).json({ agent });
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  }));

  app.put('/api/agents/:name', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      const name = String(req.params.name);
      const agent = await deps.agentRoleService.updateRole(name, parseAgentRoleInput(req.body, name));
      res.json({ agent });
    } catch (error: unknown) {
      res.status(400).json(createErrorResponse(error));
    }
  }));

  app.delete('/api/agents/:name', wrap(async (req, res) => {
    if (!deps.agentRoleService) return unavailable(res, 'Agent role service unavailable');
    try {
      await deps.agentRoleService.deleteRole(String(req.params.name));
      deps.sessionRouting.deleteAgentBindings(String(req.params.name));
      res.json({ success: true });
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
      const response = await createChatResponse({ sessionKey, message, channel, chatId });
      res.json(response);
    } catch (error: unknown) {
      deps.log.error(`对话请求失败: ${normalizeApiError(error)}`);
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
      deps.log.error('API 外发消息失败', { channel: req.params.name, chatId, error: normalizeApiError(error) });
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
      await deps.updateConfig(() => newConfig as Config);
      res.json({ success: true });
    } catch (error: unknown) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        return badRequest(res, issue.message, issue.field);
      }

      deps.log.error('API 配置更新失败', { error: normalizeApiError(error) });
      serverError(res, error);
    }
  });
}
