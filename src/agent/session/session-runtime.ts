import type { ChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import { commandParser } from '@/features/commands/command-parser.js';
import { logger } from '@/platform/observability/logger.js';
import type { SessionContext } from './session-context.js';
import {
  sessionService,
  type TemporarySessionOptions,
  type TemporarySessionResult,
} from './session-service.js';

interface ResolvedSessionState {
  sessionContext: SessionContext;
  sessionId: string;
}

function resolveSessionForReceive(ctx: ChannelContext): ResolvedSessionState {
  const sessionContext = sessionService.resolveInteractiveSessionForReceive(ctx.received);

  return {
    sessionContext,
    sessionId: sessionContext.session.id,
  };
}

export const sessionStage: MiddlewareFunc = async (ctx: ChannelContext, next: () => Promise<void>) => {
  try {
    const resolved = resolveSessionForReceive(ctx);

    if (!ctx.state) {
      ctx.state = {} as PipelineState;
    }

    ctx.state.session = resolved;

    logger.debug(
      {
        sessionId: resolved.sessionId,
        channel: resolved.sessionContext.session.channel,
        type: resolved.sessionContext.session.type,
        chatId: resolved.sessionContext.session.chatId,
      },
      'Session stage: session injected'
    );

    await next();

    if (!commandParser.isCommand(ctx.received.text ?? '')) {
      sessionService.persistRuntimeSession(resolved.sessionContext);
    }
  } catch (error) {
    logger.error({ error }, 'Session stage: failed to resolve session');
    throw error;
  }
};

export function getSessionForCommandContext(ctx: CommandContext): SessionContext | null {
  return sessionService.getRuntimeSessionForCommandContext(ctx);
}

export function switchRoleForCommandContext(ctx: CommandContext, roleId: string): { success: boolean; message: string } {
  return sessionService.switchRoleForCommandContext(ctx, roleId);
}

export function getRoleInfoForCommandContext(ctx: CommandContext): {
  roleId: string;
  roleName: string;
  allowedTools: string[];
} {
  return sessionService.getRoleInfoForCommandContext(ctx);
}

export function clearSessionById(sessionId: string): boolean {
  return sessionService.clearSession(sessionId);
}

export async function compactSessionForCommandContext(ctx: CommandContext): Promise<{ success: boolean; message: string }> {
  return sessionService.compactSessionForCommandContext(ctx);
}

export function createTemporarySession(
  cronJobId: string,
  options: TemporarySessionOptions
): TemporarySessionResult {
  return sessionService.createTemporarySession(cronJobId, options);
}
