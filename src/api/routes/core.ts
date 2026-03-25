import type { Express } from 'express';
import { getConfigValidationIssue } from '../../config/index.js';
import type { ChannelManager } from '../../channels/ChannelManager.js';
import type { Config } from '../../types.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import { parseAgentRoleInput } from '../mappers/agentRoleMapper.js';
import type { SessionRoutingService } from '../../agent/infrastructure/session/SessionRoutingService.js';
import type { AgentRoleService } from '../../agent/infrastructure/roles/AgentRoleService.js';
import type { AgentRuntime } from '../../agent/index.js';
import { preserveServerTokenInApiConfig, sanitizeConfigForApi } from '../configPayload.js';
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  normalizeApiError
} from '../errors.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { ChatApiService } from '../../features/chat/ChatApiService.js';
import { ChannelApiService } from '../../features/channels/ChannelApiService.js';
import { SessionApiService } from '../../features/sessions/SessionApiService.js';
import type { SessionManager } from '../../session/SessionManager.js';

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

function toAgentRoleError(error: unknown, name?: string): Error {
  const message = normalizeApiError(error);

  if (message.includes('already exists')) {
    return new ConflictError(message);
  }
  if (message.includes('not found')) {
    return new NotFoundError('Agent role', name);
  }

  return new ValidationError(message);
}

export function registerCoreRoutes(app: Express, deps: CoreRouteDeps): void {
  const sessionService = new SessionApiService(
    deps.sessionManager,
    deps.sessionRouting,
    deps.agentRoleService
  );
  const chatService = new ChatApiService(deps.agentRuntime, deps.maxMessageLength);
  const channelService = new ChannelApiService(
    deps.channelManager,
    deps.getConfig,
    deps.maxMessageLength
  );

  app.get('/api/status', (_req, res) => {
    res.json({
      version: deps.packageVersion,
      uptime: process.uptime(),
      channels: channelService.getChannelStatus(),
      sessions: deps.sessionManager.count(),
      agentRunning: deps.agentRuntime.isRunning()
    });
  });

  app.get('/api/sessions', asyncHandler(async (_req, res) => {
    res.json({ sessions: await sessionService.listSessions() });
  }));

  app.get('/api/sessions/:key', asyncHandler(async (req, res) => {
    res.json(await sessionService.getSessionDetails(String(req.params.key)));
  }));

  app.delete('/api/sessions/:key', asyncHandler(async (req, res) => {
    res.json(await sessionService.deleteSession(String(req.params.key)));
  }));

  app.get('/api/agents', (_req, res) => {
    if (!deps.agentRoleService) {
      return res.json({ agents: [] });
    }

    return res.json({ agents: deps.agentRoleService.listResolvedRoles() });
  });

  app.post('/api/agents', asyncHandler(async (req, res) => {
    if (!deps.agentRoleService) {
      throw new ServiceUnavailableError('Agent role service unavailable');
    }

    try {
      const agent = await deps.agentRoleService.createRole(parseAgentRoleInput(req.body));
      res.status(201).json({ agent });
    } catch (error) {
      throw toAgentRoleError(error);
    }
  }));

  app.put('/api/agents/:name', asyncHandler(async (req, res) => {
    if (!deps.agentRoleService) {
      throw new ServiceUnavailableError('Agent role service unavailable');
    }

    const name = String(req.params.name);
    try {
      const agent = await deps.agentRoleService.updateRole(name, parseAgentRoleInput(req.body, name));
      res.json({ agent });
    } catch (error) {
      throw toAgentRoleError(error, name);
    }
  }));

  app.delete('/api/agents/:name', asyncHandler(async (req, res) => {
    if (!deps.agentRoleService) {
      throw new ServiceUnavailableError('Agent role service unavailable');
    }

    const name = String(req.params.name);
    try {
      await deps.agentRoleService.deleteRole(name);
      deps.sessionRouting.deleteAgentBindings(name);
      res.json({ success: true });
    } catch (error) {
      throw toAgentRoleError(error, name);
    }
  }));

  app.post('/api/chat', asyncHandler(async (req, res) => {
    const { sessionKey, message, channel, chatId } = req.body ?? {};
    deps.log.info('收到 API 对话请求', {
      request_id: req.requestId,
      sessionKey: sessionKey || 'auto',
      channel,
      chatId
    });
    const response = await chatService.createChatResponse({ sessionKey, message, channel, chatId });
    res.json(response);
  }));

  app.get('/api/channels', (_req, res) => {
    res.json(channelService.getChannelStatus());
  });

  app.post('/api/channels/:name/send', asyncHandler(async (req, res) => {
    deps.log.info('收到 API 外发消息请求', {
      request_id: req.requestId,
      channel: String(req.params.name),
      chatId: req.body?.chatId
    });
    res.json(await channelService.sendMessage(String(req.params.name), req.body ?? {}));
  }));

  app.get('/api/tools', (_req, res) => {
    res.json({ tools: deps.toolRegistry?.getDefinitions() ?? [] });
  });

  app.get('/api/config', (_req, res) => {
    res.json(sanitizeConfigForApi(deps.getConfig()));
  });

  app.put('/api/config', asyncHandler(async (req, res) => {
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) {
      throw new ValidationError('config body must be an object', 'config');
    }

    deps.log.info('收到 API 配置更新请求', {
      request_id: req.requestId
    });

    try {
      const currentConfig = deps.getConfig();
      await deps.updateConfig(() => preserveServerTokenInApiConfig(newConfig, currentConfig) as Config);
      res.json({ success: true });
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        throw new ValidationError(issue.message, issue.field);
      }
      throw error;
    }
  }));
}
