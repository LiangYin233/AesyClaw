import type { IChannelContext, IUnifiedMessage, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import type { IConfigManager } from '@/contracts/config-manager.js';
import type { IRoleManager } from '@/contracts/role-manager.js';
import type { ISystemPromptBuilder } from '@/contracts/system-prompt-builder.js';
import { configManager } from '@/features/config/config-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import { systemPromptManager } from '@/features/roles/system-prompt-manager.js';
import { sessionRepository } from '@/platform/db/repositories/session-repository.js';
import { logger } from '@/platform/observability/logger.js';
import type { SessionContext, SessionMetadata } from './session-context.js';
import { SessionId } from './session-id.js';
import { SessionRegistry } from './session-registry.js';

let sessionRegistryInstance: SessionRegistry | null = null;

export type { SessionRegistry };

export interface SessionSummary {
  metadata: SessionMetadata;
}

export interface SessionStats {
  total: number;
  byChannel: Record<string, number>;
  byType: Record<string, number>;
}

export interface ResolvedSessionState {
  sessionContext: SessionContext;
  sessionId: string;
}

export function getSessionRegistry(): SessionRegistry {
  if (!sessionRegistryInstance) {
    sessionRegistryInstance = new SessionRegistry({
      configManager: configManager as unknown as IConfigManager,
      roleManager: roleManager as unknown as IRoleManager,
      systemPromptBuilder: systemPromptManager as unknown as ISystemPromptBuilder,
    });
  }

  return sessionRegistryInstance;
}

export const sessionRegistry = getSessionRegistry();

export function resolveSessionForInbound(inbound: IUnifiedMessage): ResolvedSessionState {
  const channel = inbound.channelId;
  const type = (inbound.metadata?.type as string) || 'default';
  const chatId = inbound.chatId;

  const existingSessionId = sessionRegistry.getSessionIdByChatId(channel, type, chatId);
  let sessionId: string;
  let components: { channel: string; type: string; chatId: string; session: string };

  if (existingSessionId) {
    sessionId = existingSessionId;
    components = SessionId.parse(sessionId);
    logger.debug({ sessionId, channel, type, chatId }, '复用已有会话');
  } else {
    sessionId = SessionId.fromUnifiedMessage(inbound);
    components = SessionId.parse(sessionId);
  }

  const sessionContext = sessionRegistry.getOrCreate(sessionId, {
    channel: components.channel,
    type: components.type,
    chatId: components.chatId,
    session: components.session,
  });

  sessionRepository.ensure({
    sessionId,
    chatId: components.chatId,
    channel: components.channel,
    type: components.type,
    metadata: {
      sessionId,
      session: components.session,
    },
  });

  return {
    sessionContext,
    sessionId,
  };
}

export const sessionMessageStage: MiddlewareFunc = async (ctx: IChannelContext, next: () => Promise<void>) => {
  try {
    const resolved = resolveSessionForInbound(ctx.inbound);

    if (!ctx.state) {
      ctx.state = {} as PipelineState;
    }

    ctx.state.session = resolved;

    logger.debug(
      {
        sessionId: resolved.sessionId,
        channel: resolved.sessionContext.metadata.channel,
        type: resolved.sessionContext.metadata.type,
        chatId: resolved.sessionContext.metadata.chatId,
      },
      'Session stage: session injected'
    );

    await next();
  } catch (error) {
    logger.error({ error }, 'Session stage: failed to create session');
    throw error;
  }
};

export function getSessionForCommandContext(ctx: CommandContext): SessionContext | null {
  const existingSessionId = sessionRegistry.getSessionIdByChatId(
    ctx.channelId,
    ctx.messageType,
    ctx.chatId
  );

  if (existingSessionId) {
    return sessionRegistry.getSession(existingSessionId) || null;
  }

  const sessions = sessionRegistry.getSessionsByChatId(ctx.chatId);
  return sessions.length > 0 ? sessions[0] : null;
}

export function getSessionSummaries(): SessionSummary[] {
  return sessionRegistry.getAllSessions().map(s => ({ metadata: s.metadata }));
}

export function getSessionStats(): SessionStats {
  return sessionRegistry.getStats();
}

export function clearSessionById(sessionId: string): boolean {
  return sessionRegistry.removeSession(sessionId);
}

export interface TemporarySessionOptions {
  chatId: string;
  prompt: string;
}

export interface TemporarySessionResult {
  sessionId: string;
  session: SessionContext;
}

export function createTemporarySession(
  cronJobId: string,
  options: TemporarySessionOptions
): TemporarySessionResult {
  const sessionPart = SessionId.generateSession();
  const sessionId = `cron:cron:${cronJobId}:${sessionPart}`;

  const session = sessionRegistry.getOrCreate(sessionId, {
    channel: 'cron',
    type: 'cron',
    chatId: options.chatId,
    session: sessionPart,
  });

  return { sessionId, session };
}

export function removeTemporarySession(sessionId: string): boolean {
  return sessionRegistry.removeSession(sessionId);
}
