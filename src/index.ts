import { ChannelPipeline } from './agent/core/pipeline';
import { IUnifiedMessage, MiddlewareFunc } from './agent/core/types';
import { AgentManager } from './agent/core/engine';
import { ToolRegistry } from './platform/tools/registry';
import { ITool } from './platform/tools/types';
import { LLMProviderType } from './agent/llm/types';
import { logger } from './platform/observability/logger';
import { Bootstrap, bootstrap } from './bootstrap';

const toolRegistry = ToolRegistry.getInstance();
logger.info('🔧 工具注册完成');

const loggingMiddleware: MiddlewareFunc = async (ctx, next) => {
  logger.info({ traceId: ctx.traceId }, '📝 请求开始');
  await next();
  logger.info({ traceId: ctx.traceId }, '📝 请求完成');
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

  logger.info({ traceId: ctx.traceId, chatId }, '🤖 Agent 处理请求');

  try {
    const result = await agent.run(ctx.inbound.text);
    ctx.outbound.text = result.success ? result.finalText : `错误: ${result.error}`;
    ctx.outbound.error = result.error;
  } catch (error) {
    ctx.outbound.text = 'Agent 执行出错';
    ctx.outbound.error = error instanceof Error ? error.message : String(error);
    logger.error({ traceId: ctx.traceId, chatId, error }, '❌ Agent 异常');
  }

  await next();
};

const pipeline = new ChannelPipeline();
pipeline.use(loggingMiddleware);
pipeline.use(agentMiddleware);

async function main() {
  logger.info('========================================');
  logger.info('🚀 AesyClaw Agent Framework 启动中...');
  logger.info('========================================');

  try {
    await bootstrap();
    logger.info('✅ Bootstrap 完成');
  } catch (error) {
    logger.error({ error }, '❌ Bootstrap 失败');
    process.exit(1);
  }

  logger.info({ toolCount: toolRegistry.getAllToolDefinitions().length }, '✅ 系统就绪');

  const status = Bootstrap.getStatus();
  logger.info({ status }, '系统状态');
}

main().catch(console.error);

export { pipeline, toolRegistry };
