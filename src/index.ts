import { z } from 'zod';
import { ChannelPipeline } from './agent/core/pipeline';
import { IUnifiedMessage, MiddlewareFunc } from './agent/core/types';
import { AgentManager } from './agent/core/engine';
import { ToolRegistry, BuiltInToolExecutor } from './platform/tools/registry';
import { ITool, ToolExecuteContext, zodToToolParameters } from './platform/tools/types';
import { LLMProviderType } from './agent/llm/types';
import { logger } from './platform/observability/logger';
import { Bootstrap, bootstrap } from './bootstrap';

class CalculatorTool implements ITool {
  readonly name = 'calculator';
  readonly description = 'Perform mathematical calculations. Use this when you need to compute numerical results.';
  readonly parametersSchema = z.object({
    expression: z.string().describe('The mathematical expression to evaluate'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, context: ToolExecuteContext) {
    return BuiltInToolExecutor.executeCalculator(args as { expression: string }, context);
  }
}

class CurrentTimeTool implements ITool {
  readonly name = 'current_time';
  readonly description = 'Get the current date and time.';
  readonly parametersSchema = z.object({});

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: Record<string, unknown>, context: ToolExecuteContext) {
    return BuiltInToolExecutor.executeCurrentTime(args, context);
  }
}

class WebSearchTool implements ITool {
  readonly name = 'web_search';
  readonly description = 'Search the web for information.';
  readonly parametersSchema = z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  });

  getDefinition() {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, context: ToolExecuteContext) {
    return BuiltInToolExecutor.executeWebSearch(args as { query: string; maxResults?: number }, context);
  }
}

const toolRegistry = ToolRegistry.getInstance();
toolRegistry.register(new CalculatorTool());
toolRegistry.register(new CurrentTimeTool());
toolRegistry.register(new WebSearchTool());
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
