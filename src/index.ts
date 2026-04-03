import { ChannelPipeline } from './agent/core/pipeline';
import { IUnifiedMessage, MiddlewareFunc } from './agent/core/types';
import { AgentManager } from './agent/core/engine';
import { ToolRegistry } from './platform/tools/registry';
import { ITool } from './platform/tools/types';
import { LLMProviderType } from './agent/llm/types';
import { logger } from './platform/observability/logger';
import { Bootstrap, bootstrap } from './bootstrap';

const toolRegistry = ToolRegistry.getInstance();
logger.info('ToolRegistry initialized');

const loggingMiddleware: MiddlewareFunc = async (ctx, next) => {
  logger.info({ traceId: ctx.traceId }, 'Request started');
  await next();
  logger.info({ traceId: ctx.traceId }, 'Request completed');
};

const agentMiddleware: MiddlewareFunc = async (ctx, next) => {
  const chatId = ctx.inbound.chatId;
  const agentManager = AgentManager.getInstance();
  const agent = agentManager.getOrCreate(chatId, {
    llm: {
      provider: LLMProviderType.OpenAIChat,
      model: 'gpt-4o-mini',
    },
    maxSteps: 5,
    systemPrompt: '你是一个有帮助的AI助手，可以使用工具来回答问题。',
    tools: toolRegistry.getAllToolDefinitions(),
  });

  logger.info({ traceId: ctx.traceId, chatId }, 'Agent processing request');

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
