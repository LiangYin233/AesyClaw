import type { ChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import { commandParser } from '@/features/commands/command-parser.js';
import { logger } from '@/platform/observability/logger.js';
import type { ChatContext } from './session-context.js';
import {
  chatService,
  type TempChatResult,
} from './session-service.js';

interface ResolvedSessionState {
  sessionContext: ChatContext;
  sessionId: string;
}

function resolveSessionForReceive(ctx: ChannelContext): ResolvedSessionState {
  const sessionContext = chatService.resolveForReceive(ctx.received);

  return {
    sessionContext,
    sessionId: sessionContext.session.chatId,
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
      },
      'Session stage: chat context injected'
    );

    await next();

    if (!commandParser.isCommand(ctx.received.text ?? '')) {
      chatService.save(resolved.sessionContext);
    }
  } catch (error) {
    logger.error({ error }, 'Session stage: failed to resolve session');
    throw error;
  }
};

export function getSessionForCommandContext(ctx: CommandContext): ChatContext | null {
  return chatService.getForCommand(ctx);
}

export function switchRoleForCommandContext(ctx: CommandContext, roleId: string): { success: boolean; message: string } {
  return chatService.switchRole(ctx, roleId);
}

export function getRoleInfoForCommandContext(ctx: CommandContext): {
  roleId: string;
  roleName: string;
  allowedTools: string[];
} {
  return chatService.getRoleInfo(ctx);
}

export function clearSessionById(ctx: CommandContext): boolean {
  return chatService.clearChat(ctx);
}

export async function compactSessionForCommandContext(ctx: CommandContext): Promise<{ success: boolean; message: string }> {
  return chatService.compactChat(ctx);
}

export function createTemporarySession(
  cronJobId: string,
  _options?: { chatId?: string }
): TempChatResult {
  return chatService.createTempChat(cronJobId);
}
