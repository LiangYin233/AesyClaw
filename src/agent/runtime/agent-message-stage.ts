import type { SessionContext } from '@/agent/session/session-context.js';
import type { ChannelContext, ChannelReceiveMessage, MiddlewareFunc } from '@/agent/types.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';

interface MediaAttachment {
  type: string;
  url: string;
  filename?: string;
}

function getSessionFromContext(ctx: ChannelContext): SessionContext | null {
  const state = ctx.state?.session;
  if (!state) return null;
  return state.sessionContext as SessionContext;
}

function getSessionIdFromContext(ctx: ChannelContext): string | null {
  return ctx.state?.session?.sessionId || null;
}

function normalizeUserInput(received: ChannelReceiveMessage): string {
  let userInput = received.text ?? '';
  const media = received.metadata?.media as MediaAttachment[] | undefined;

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

export const agentStage: MiddlewareFunc = async (ctx: ChannelContext, next: () => Promise<void>) => {
  const sessionContext = getSessionFromContext(ctx);
  const sessionId = getSessionIdFromContext(ctx);

  if (!sessionContext) {
    logger.error({}, 'SessionContext not found, ensure session message stage is registered before agent stage');
    ctx.sendMessage.text = 'System error: Session not initialized';
    await next();
    return;
  }

  const agent = sessionContext.agent;
  const runtimeInfo = agent.getRuntimeInfo();

  logger.info(
      {
        sessionId,
        chatId: ctx.received.chatId,
        channel: sessionContext.session.channel,
        type: sessionContext.session.type,
        provider: runtimeInfo.llm.provider,
        model: runtimeInfo.llm.model,
      },
    'Agent stage: starting agent processing'
  );

  try {
    const userInput = normalizeUserInput(ctx.received);

    if (!userInput.trim()) {
      ctx.sendMessage.text = '';
      await next();
      return;
    }

    const result = await agent.run(userInput, { send: ctx.send });

    if (result.success) {
      ctx.sendMessage.text = result.finalText;
      logger.info({ sessionId, chatId: ctx.received.chatId }, 'Agent processing completed');
    } else {
      ctx.sendMessage.text = `Error: ${result.error}`;
      ctx.sendMessage.error = result.error;
      logger.error({ sessionId, chatId: ctx.received.chatId, error: result.error }, 'Agent processing failed');
    }
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    ctx.sendMessage.text = `Agent error: ${errorMessage}`;
    ctx.sendMessage.error = errorMessage;
    logger.error({ sessionId, chatId: ctx.received.chatId, error: errorMessage }, 'Agent exception');
  }

  await next();
};
