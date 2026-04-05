import { ChannelPipeline } from './agent/core/pipeline';
import { IUnifiedMessage, MiddlewareFunc } from './agent/core/types';
import { ToolRegistry } from './platform/tools/registry';
import { ITool } from './platform/tools/types';
import { LLMProviderType } from './agent/llm/types';
import { logger } from './platform/observability/logger';
import { Bootstrap, bootstrap } from './bootstrap';
import { sessionRegistry } from './agent/core/session/session-registry.js';
import { SessionId } from './agent/core/session/session-id.js';

const toolRegistry = ToolRegistry.getInstance();
logger.info('ToolRegistry initialized');

const loggingMiddleware: MiddlewareFunc = async (ctx, next) => {
  logger.info({ traceId: ctx.traceId }, 'Request started');
  await next();
  logger.info({ traceId: ctx.traceId }, 'Request completed');
};

const sessionMiddleware: MiddlewareFunc = async (ctx, next) => {
  const chatId = ctx.inbound.chatId;
  const channelId = ctx.inbound.channelId;
  const sessionId = SessionId.fromUnifiedMessage(ctx.inbound);

  sessionRegistry.getOrCreate(sessionId, {
    channel: channelId,
    type: (ctx.inbound.metadata?.type as string) || 'default',
    chatId: chatId,
    session: SessionId.parse(sessionId).session,
  });

  await next();
};

const agentMiddleware: MiddlewareFunc = async (ctx, next) => {
  const chatId = ctx.inbound.chatId;
  const sessionId = SessionId.fromUnifiedMessage(ctx.inbound);
  const sessionContext = sessionRegistry.getSession(sessionId);

  if (!sessionContext) {
    ctx.outbound.text = 'Session not found';
    await next();
    return;
  }

  const agent = sessionContext.agent;
  logger.info({ traceId: ctx.traceId, chatId, sessionId }, 'Agent processing request');

  try {
    const result = await agent.run(ctx.inbound.text);
    ctx.outbound.text = result.success ? result.finalText : `Error: ${result.error}`;
    ctx.outbound.error = result.error;
  } catch (error) {
    ctx.outbound.text = 'Agent execution error';
    ctx.outbound.error = error instanceof Error ? error.message : String(error);
    logger.error({ traceId: ctx.traceId, chatId, error }, 'Agent exception');
  }

  await next();
};

const pipeline = new ChannelPipeline();
pipeline.use(loggingMiddleware);
pipeline.use(sessionMiddleware);
pipeline.use(agentMiddleware);

async function main() {
  try {
    await bootstrap();
  } catch (error) {
    logger.error({ error }, 'Bootstrap failed');
    process.exit(1);
  }

  const status = Bootstrap.getStatus();
  logger.info({ toolCount: status.toolRegistry.totalTools, status }, 'System ready');
}

main().catch(console.error);

export { pipeline, toolRegistry };
