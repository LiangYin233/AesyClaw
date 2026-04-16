import type { SessionContext } from '@/agent/session/session-context.js';
import type { IChannelContext, IUnifiedMessage, MiddlewareFunc } from '@/agent/types.js';
import { logger } from '@/platform/observability/logger.js';

interface MediaAttachment {
  type: string;
  url: string;
  filename?: string;
}

function getSessionFromContext(ctx: IChannelContext): SessionContext | null {
  const state = ctx.state?.session;
  if (!state) return null;
  return state.sessionContext as SessionContext;
}

function getSessionIdFromContext(ctx: IChannelContext): string | null {
  return ctx.state?.session?.sessionId || null;
}

function normalizeUserInput(inbound: IUnifiedMessage): string {
  let userInput = inbound.text ?? '';
  const media = inbound.metadata?.media as MediaAttachment[] | undefined;

  if (media && Array.isArray(media) && media.length > 0) {
    const mediaDescriptions: string[] = [];

    for (const item of media) {
      if (item.type === 'image') {
        mediaDescriptions.push(`[图片: ${item.url}]`);
      } else if (item.type === 'audio') {
        mediaDescriptions.push(`[语音: ${item.url}]`);
      } else if (item.type === 'file') {
        mediaDescriptions.push(`[文件: ${item.filename || item.url}]`);
      } else if (item.type === 'video') {
        mediaDescriptions.push(`[视频: ${item.url}]`);
      }
    }

    if (mediaDescriptions.length > 0) {
      userInput = `${userInput}\n\n附件信息：\n${mediaDescriptions.join('\n')}`;
    }
  }

  return userInput;
}

export const agentMessageStage: MiddlewareFunc = async (ctx: IChannelContext, next: () => Promise<void>) => {
  const sessionContext = getSessionFromContext(ctx);
  const sessionId = getSessionIdFromContext(ctx);

  if (!sessionContext) {
    logger.error({}, 'SessionContext not found, ensure session message stage is registered before agent stage');
    ctx.outbound.text = 'System error: Session not initialized';
    await next();
    return;
  }

  const agent = sessionContext.agent;
  const runtimeInfo = agent.getRuntimeInfo();

  logger.info(
      {
        sessionId,
        chatId: ctx.inbound.chatId,
        channel: sessionContext.session.channel,
        type: sessionContext.session.type,
        provider: runtimeInfo.llm.provider,
        model: runtimeInfo.llm.model,
      },
    'Agent stage: starting agent processing'
  );

  try {
    const userInput = normalizeUserInput(ctx.inbound);

    if (!userInput.trim()) {
      ctx.outbound.text = '';
      await next();
      return;
    }

    const result = await agent.run(userInput);

    if (result.success) {
      ctx.outbound.text = result.finalText;
      logger.info({ sessionId, chatId: ctx.inbound.chatId }, 'Agent processing completed');
    } else {
      ctx.outbound.text = `Error: ${result.error}`;
      ctx.outbound.error = result.error;
      logger.error({ sessionId, chatId: ctx.inbound.chatId, error: result.error }, 'Agent processing failed');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.outbound.text = `Agent error: ${errorMessage}`;
    ctx.outbound.error = errorMessage;
    logger.error({ sessionId, chatId: ctx.inbound.chatId, error: errorMessage }, 'Agent exception');
  }

  await next();
};
