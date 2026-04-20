import type { ChannelContext, MiddlewareFunc, PipelineState } from '@/agent/types.js';
import type { CommandContext } from '@/contracts/commands.js';
import { commandParser } from '@/features/commands/command-parser.js';
import { logger } from '@/platform/observability/logger.js';
import type { ChatContext } from './session-context.js';
import type { ChatService } from './session-service.js';

interface ResolvedSessionState {
    sessionContext: ChatContext;
    sessionId: string;
}

function resolveSessionForReceive(
    chatService: ChatService,
    ctx: ChannelContext,
): ResolvedSessionState {
    const sessionContext = chatService.resolveForReceive(ctx.received);

    return {
        sessionContext,
        sessionId: sessionContext.session.chatId,
    };
}

export function createSessionStage(chatService: ChatService): MiddlewareFunc {
    return async (ctx: ChannelContext, next: () => Promise<void>) => {
        try {
            const resolved = resolveSessionForReceive(chatService, ctx);

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
                'Session stage: chat context injected',
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
}

export function getSessionForCommandContext(
    chatService: ChatService,
    ctx: CommandContext,
): ChatContext | null {
    return chatService.getForCommand(ctx);
}

export function switchRoleForCommandContext(
    chatService: ChatService,
    ctx: CommandContext,
    roleId: string,
): { success: boolean; message: string } {
    return chatService.switchRole(ctx, roleId);
}

export function getRoleInfoForCommandContext(
    chatService: ChatService,
    ctx: CommandContext,
): {
    roleId: string;
    roleName: string;
    allowedTools: string[];
} {
    return chatService.getRoleInfo(ctx);
}

export function clearSessionById(chatService: ChatService, ctx: CommandContext): boolean {
    return chatService.clearChat(ctx);
}

export async function compactSessionForCommandContext(
    chatService: ChatService,
    ctx: CommandContext,
): Promise<{ success: boolean; message: string }> {
    return chatService.compactChat(ctx);
}
