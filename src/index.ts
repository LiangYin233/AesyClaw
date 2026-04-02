import { z } from 'zod';
import { ChannelPipeline } from './agent/core/pipeline';
import {
  IUnifiedMessage,
  IChannelContext,
  MiddlewareFunc,
} from './agent/core/types';
import { AgentManager } from './agent/core/engine';
import { ToolRegistry, BuiltInToolExecutor } from './platform/tools/registry';
import { ITool, ToolExecuteContext, zodToToolParameters } from './platform/tools/types';
import { LLMProviderFactory, createLLMSession } from './agent/llm/factory';
import { LLMProviderType, MessageRole } from './agent/llm/types';
import { logger } from './platform/observability/logger';
import {
  SessionMemoryManager,
  MemoryManagerFactory,
  TokenBudgetCalculator,
  MessageTrimmer,
  LosslessSummarizer,
  createMemoryConfig,
  DEFAULT_MEMORY_CONFIG,
  MemoryEvent,
} from './agent/core/memory/index';
import { Bootstrap, bootstrap, shutdown } from './bootstrap';
import { pathResolver } from './platform/utils/paths';
import { sqliteManager } from './platform/db/sqlite-manager';
import { configManager } from './features/config/config-manager';
import {
  SessionRepository,
  sessionRepository,
  CronJobRepository,
  cronJobRepository,
  CronJobScheduler,
  cronJobScheduler,
  generateCronId,
} from './platform/db/index';
import { configInjectionMiddleware, getConfigFromContext } from './middlewares/config.middleware';
import {
  createCronJob,
  listCronJobs,
  deleteCronJob,
  toggleCronJob,
  updateCronJob,
  parseCronDescription,
} from './features/cron/index';

class CalculatorTool implements ITool {
  readonly name = 'calculator';
  readonly description = 'Perform mathematical calculations. Use this when you need to compute numerical results.';
  readonly parametersSchema = z.object({
    expression: z.string().describe('The mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "10 * 5")'),
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
  readonly description = 'Get the current date and time. Useful for time-related queries.';
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
  readonly description = 'Search the web for information. Use this when you need to find up-to-date information.';
  readonly parametersSchema = z.object({
    query: z.string().describe('The search query to look up'),
    maxResults: z.number().optional().describe('Maximum number of results to return'),
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
  logger.info({ traceId: ctx.traceId }, '📝 [Logging] 开始记录请求');
  await next();
  logger.info({ traceId: ctx.traceId }, '📝 [Logging] 请求处理完成');
};

const authMiddleware: MiddlewareFunc = async (ctx, next) => {
  if (ctx.inbound.senderId === 'blocked-user') {
    ctx.outbound.text = '访问被拒绝：该用户已被禁止访问。';
    logger.warn({ traceId: ctx.traceId, senderId: ctx.inbound.senderId }, '🚫 [Auth] 用户被禁止访问');
    return;
  }
  logger.info({ traceId: ctx.traceId, senderId: ctx.inbound.senderId }, '✅ [Auth] 认证通过');
  await next();
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

  logger.info({ traceId: ctx.traceId, chatId }, '🤖 [Agent] 开始处理请求');

  try {
    const result = await agent.run(ctx.inbound.text);

    if (result.success) {
      ctx.outbound.text = result.finalText;
      logger.info(
        { 
          traceId: ctx.traceId, 
          chatId, 
          steps: result.steps, 
          toolCalls: result.toolCalls,
          tokenUsage: result.tokenUsage,
        },
        '✅ [Agent] 请求处理成功'
      );
    } else {
      ctx.outbound.text = result.finalText;
      ctx.outbound.error = result.error;
      logger.error({ traceId: ctx.traceId, chatId, error: result.error }, '❌ [Agent] 请求处理失败');
    }
  } catch (error) {
    ctx.outbound.text = 'Agent 执行出错';
    ctx.outbound.error = error instanceof Error ? error.message : String(error);
    logger.error({ traceId: ctx.traceId, chatId, error }, '❌ [Agent] 异常捕获');
  }

  await next();
};

async function testToolRegistry() {
  logger.info('=== 测试工具注册中心 ===');
  
  const toolDefs = toolRegistry.getAllToolDefinitions();
  logger.info({ toolCount: toolDefs.length, tools: toolDefs.map(t => t.name) }, '已注册工具列表');

  const context: ToolExecuteContext = {
    chatId: 'test-chat',
    senderId: 'test-user',
    traceId: 'test-trace',
  };

  logger.info('--- 测试计算器工具 ---');
  const calcResult = await toolRegistry.executeTool('calculator', { expression: '2 + 2' }, context);
  logger.info({ result: calcResult }, '计算器结果');

  logger.info('--- 测试时间工具 ---');
  const timeResult = await toolRegistry.executeTool('current_time', {}, context);
  logger.info({ result: timeResult }, '时间结果');

  logger.info('--- 测试搜索工具 ---');
  const searchResult = await toolRegistry.executeTool('web_search', { query: 'TypeScript Zod validation', maxResults: 2 }, context);
  logger.info({ result: searchResult }, '搜索结果');

  logger.info('--- 测试参数验证（反幻觉） ---');
  const validationResult = await toolRegistry.executeTool('calculator', { expression: 123 }, context);
  logger.info({ result: validationResult }, '参数验证结果');
}

async function testLLMFactory() {
  logger.info('=== 测试 LLM Provider 工厂 ===');

  const factory = LLMProviderFactory.getInstance();

  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

  if (hasOpenAIKey) {
    logger.info('--- 创建 OpenAI Chat Adapter ---');
    try {
      const openaiChatAdapter = factory.createAdapter({
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      });
      logger.info({ provider: openaiChatAdapter.providerType }, 'Adapter 创建成功');

      logger.info('--- 创建 OpenAI Completion Adapter ---');
      const openaiCompletionAdapter = factory.createAdapter({
        provider: LLMProviderType.OpenAICompletion,
        model: 'gpt-3.5-turbo-instruct',
      });
      logger.info({ provider: openaiCompletionAdapter.providerType }, 'Completion Adapter 创建成功');

      logger.info('--- 测试缓存复用 ---');
      const cachedAdapter = factory.createAdapter({
        provider: LLMProviderType.OpenAIChat,
        model: 'gpt-4o-mini',
      });
      logger.info({ sameAdapter: cachedAdapter === openaiChatAdapter }, '缓存复用测试');
    } catch (error) {
      logger.error({ error }, 'OpenAI Adapter 创建失败');
    }
  } else {
    logger.warn('⚠️ 未设置 OPENAI_API_KEY 环境变量，跳过 OpenAI Adapter 测试');
  }

  if (hasAnthropicKey) {
    logger.info('--- 创建 Anthropic Adapter ---');
    try {
      const anthropicAdapter = factory.createAdapter({
        provider: LLMProviderType.Anthropic,
        model: 'claude-sonnet-4-20250514',
      });
      logger.info({ provider: anthropicAdapter.providerType }, 'Anthropic Adapter 创建成功');
    } catch (error) {
      logger.error({ error }, 'Anthropic Adapter 创建失败');
    }
  } else {
    logger.warn('⚠️ 未设置 ANTHROPIC_API_KEY 环境变量，跳过 Anthropic Adapter 测试');
  }
}

async function testAgentManager() {
  logger.info('=== 测试 Agent Manager ===');

  const agentManager = AgentManager.getInstance();

  logger.info('--- 创建多个 Agent 实例 ---');
  const agent1 = agentManager.getOrCreate('chat-room-001');
  const agent2 = agentManager.getOrCreate('chat-room-002');
  const agent3 = agentManager.getOrCreate('chat-room-001');

  logger.info({ 
    agent1Id: agent1.getInstanceId(),
    agent2Id: agent2.getInstanceId(),
    sameInstance: agent1 === agent3,
    activeAgents: agentManager.getActiveAgentsCount(),
  }, 'Agent 实例管理测试');

  if (!process.env.OPENAI_API_KEY) {
    logger.warn('⚠️ 未设置 OPENAI_API_KEY 环境变量，跳过 Agent 运行测试');
    return;
  }

  logger.info('--- 测试并发请求 ---');
  const startTime = Date.now();

  const results = await Promise.all([
    agentManager.getOrCreate('chat-room-001').run('你好，请介绍一下自己'),
    agentManager.getOrCreate('chat-room-002').run('今天天气怎么样？'),
  ]);

  const duration = Date.now() - startTime;

  logger.info(
    { duration, resultCount: results.length },
    '并发请求完成'
  );

  for (let i = 0; i < results.length; i++) {
    logger.info(
      { 
        index: i, 
        success: results[i].success, 
        steps: results[i].steps,
        textPreview: results[i].finalText.substring(0, 100),
      },
      `请求 ${i + 1} 结果`
    );
  }
}

async function testMiddlewarePipeline() {
  logger.info('=== 测试中间件管道 ===');

  const pipeline = new ChannelPipeline();

  pipeline.use(loggingMiddleware);
  pipeline.use(authMiddleware);
  pipeline.use(agentMiddleware);

  if (!process.env.OPENAI_API_KEY) {
    logger.warn('⚠️ 未设置 OPENAI_API_KEY 环境变量，跳过中间件管道完整测试');
    logger.info('--- 测试中间件管道（仅认证） ---');
    
    const blockedMessage: IUnifiedMessage = {
      channelId: 'test-channel',
      chatId: 'chat-room-002',
      senderId: 'blocked-user',
      text: '你好',
      timestamp: Date.now(),
    };

    const blockedCtx = await pipeline.handleInbound(blockedMessage);
    logger.info(
      { 
        traceId: blockedCtx.traceId,
        response: blockedCtx.outbound.text,
      },
      '阻止用户请求处理完成（认证中间件测试）'
    );
    return;
  }

  logger.info('--- 测试正常请求 ---');
  const normalMessage: IUnifiedMessage = {
    channelId: 'test-channel',
    chatId: 'chat-room-001',
    senderId: 'user-001',
    text: '你好，请介绍一下自己',
    timestamp: Date.now(),
  };

  const normalCtx = await pipeline.handleInbound(normalMessage);
  logger.info(
    { 
      traceId: normalCtx.traceId,
      responseLength: normalCtx.outbound.text.length,
      hasError: !!normalCtx.outbound.error,
    },
    '正常请求处理完成'
  );

  logger.info('--- 测试被阻止用户 ---');
  const blockedMessage: IUnifiedMessage = {
    channelId: 'test-channel',
    chatId: 'chat-room-002',
    senderId: 'blocked-user',
    text: '你好',
    timestamp: Date.now(),
  };

  const blockedCtx = await pipeline.handleInbound(blockedMessage);
  logger.info(
    { 
      traceId: blockedCtx.traceId,
      response: blockedCtx.outbound.text,
    },
    '阻止用户请求处理完成'
  );
}

async function main() {
  logger.info('========================================');
  logger.info('🚀 AesyClaw Agent Framework 启动测试');
  logger.info('========================================');

  try {
    await testStorageAndConfigSystem();
    logger.info('');

    await testToolRegistry();
    logger.info('');

    await testLLMFactory();
    logger.info('');

    await testAgentManager();
    logger.info('');

    await testMiddlewarePipeline();
    logger.info('');

    await testMemorySystem();
    logger.info('');

    logger.info('========================================');
    logger.info('✅ 所有测试完成');
    logger.info('========================================');
  } catch (error) {
    logger.error({ error }, '❌ 测试执行失败');
    process.exit(1);
  }

  const toolStats = toolRegistry.getStats();
  logger.info({ toolStats }, '工具注册统计');

  const agentManager = AgentManager.getInstance();
  logger.info(
    { 
      activeAgents: agentManager.getActiveAgentsCount(),
      chatIds: agentManager.getAllChatIds(),
    },
    'Agent Manager 状态'
  );
}

async function testMemorySystem() {
  logger.info('=== 测试记忆系统 (Memory System) ===');

  logger.info('--- 1. TokenBudgetCalculator 测试 ---');
  const calculator = new TokenBudgetCalculator(DEFAULT_MEMORY_CONFIG);
  
  const testContent = '这是一个测试内容，用于验证 Token 估算功能。Hello world test.';
  const tokens = calculator.calculateSingleMessage(testContent);
  logger.info({ content: testContent, estimatedTokens: tokens }, 'Token 估算结果');

  const chineseContent = '中文内容的 Token 估算应该更高，因为每个中文字符通常算作 1.5 个 Token。';
  const chineseTokens = calculator.calculateSingleMessage(chineseContent);
  logger.info({ chineseContent, estimatedTokens: chineseTokens }, '中文 Token 估算');

  logger.info('--- 2. MessageTrimmer 测试 ---');
  const trimmer = new MessageTrimmer(DEFAULT_MEMORY_CONFIG, calculator);
  
  const shortMessage = { role: MessageRole.User, content: '短消息不需要截断' };
  const shortResult = trimmer.checkAndTrim(shortMessage);
  logger.info({ wasTruncated: shortResult.result?.wasTruncated }, '短消息截断测试');

  const longContent = 'A'.repeat(10000);
  const longMessage = { role: MessageRole.Tool, content: longContent };
  const longResult = trimmer.checkAndTrim(longMessage);
  logger.info(
    {
      originalLength: longResult.result?.originalLength,
      truncatedLength: longResult.result?.truncatedLength,
      wasTruncated: longResult.result?.wasTruncated,
      savings: longResult.result ? `${trimmer.calculateSavingsPercentage(longResult.result).toFixed(2)}%` : '0%',
    },
    '长消息截断测试'
  );

  logger.info('--- 3. SessionMemoryManager 测试 ---');
  try {
    logger.info('开始创建 SessionMemoryManager...');
    const memory = new SessionMemoryManager('memory-test-chat');
    logger.info('SessionMemoryManager 创建成功');

    memory.addMessage({ role: MessageRole.System, content: '你是我的 AI 助手。' });
    memory.addMessage({ role: MessageRole.User, content: '请介绍一下 TypeScript 的泛型' });
    
    const stats = memory.getStats();
    logger.info(
      {
        totalMessages: stats.totalMessages,
        totalTokens: stats.totalTokens,
        sacredMessages: stats.sacredMessages,
        compressibleMessages: stats.compressibleMessages,
      },
      '初始记忆统计'
    );

    memory.addMessage({ role: MessageRole.Assistant, content: 'TypeScript 泛型是一种强大的类型抽象机制...' });
    memory.addMessage({ role: MessageRole.Tool, content: '搜索结果：泛型在 2012 年被引入 TypeScript...' });
    
    const updatedStats = memory.getStats();
    logger.info(
      {
        totalMessages: updatedStats.totalMessages,
        totalTokens: updatedStats.totalTokens,
        sacredMessages: updatedStats.sacredMessages,
        compressibleMessages: updatedStats.compressibleMessages,
      },
      '添加消息后记忆统计'
    );

    logger.info('--- 4. MemoryManagerFactory 测试 ---');
    const factory = MemoryManagerFactory.getInstance();
    
    const memory1 = factory.getOrCreate('chat-A');
    const memory2 = factory.getOrCreate('chat-B');
    const memory1Again = factory.getOrCreate('chat-A');
    
    logger.info(
      {
        sameInstance: memory1 === memory1Again,
        differentInstances: memory1 !== memory2,
        activeMemories: factory.getActiveMemoryCount(),
      },
      '记忆工厂实例管理测试'
    );

    logger.info('--- 5. 事件监听测试 ---');
    let eventCount = 0;
    const unsubscribe = memory.onEvent((event: MemoryEvent) => {
      eventCount++;
      logger.info(
        { eventType: event.type, eventCount },
        '记忆事件触发'
      );
    });

    memory.addMessage({ role: MessageRole.User, content: '测试消息' });
    memory.addMessage({ role: MessageRole.Assistant, content: '测试回复' });
    
    logger.info({ eventCount }, '事件监听统计');
    unsubscribe();

    logger.info('--- 6. 导出和导入记忆测试 ---');
    const exported = memory.exportMemory();
    logger.info(
      {
        chatId: exported.chatId,
        messageCount: exported.messages.length,
        totalTokens: exported.stats.totalTokens,
      },
      '导出记忆'
    );

    const newMemory = new SessionMemoryManager('import-test-chat');
    newMemory.importMemory({ messages: exported.messages });
    
    logger.info(
      { importedMessageCount: newMemory.getMessageCount() },
      '导入记忆'
    );

    logger.info('--- 7. 记忆完整性验证测试 ---');
    const integrity = memory.validateIntegrity();
    logger.info({ integrity }, '记忆完整性验证');

    logger.info('--- 8. 清空记忆测试 ---');
    memory.clear();
    const clearedStats = memory.getStats();
    logger.info(
      {
        totalMessages: clearedStats.totalMessages,
        compressionCount: clearedStats.compressionCount,
      },
      '清空后记忆统计'
    );

    logger.info('--- 9. MemoryManagerFactory 清理测试 ---');
    factory.clearAll();
    logger.info({ activeMemories: factory.getActiveMemoryCount() }, '清理后记忆工厂状态');
  } catch (error) {
    console.error('完整的错误信息:', error);
    logger.error({ error: String(error), stack: error instanceof Error ? error.stack : undefined }, '❌ 记忆系统测试失败');
    throw error;
  }

  logger.info('--- 10. AgentEngine 记忆集成测试 ---');
  try {
    const agentManager = AgentManager.getInstance();
    const agentWithMemory = agentManager.getOrCreate('agent-memory-test', {
      llm: { provider: LLMProviderType.OpenAIChat },
      systemPrompt: '你是一个有帮助的 AI 助手。',
      memoryConfig: {
        maxContextTokens: 128000,
        compressionThreshold: 80000,
      },
    });

    const agentStats = agentWithMemory.getMemoryStats();
    logger.info(
      {
        totalMessages: agentStats.totalMessages,
        currentPhase: agentStats.currentPhase,
      },
      'Agent 记忆统计'
    );

    const agentBudget = agentWithMemory.getTokenBudget();
    logger.info(
      {
        currentTokens: agentBudget.currentTokens,
        maxTokens: agentBudget.maxTokens,
        usagePercentage: `${agentBudget.usagePercentage.toFixed(2)}%`,
      },
      'Agent Token 预算'
    );
  } catch (error) {
    logger.error({ error }, '❌ AgentEngine 记忆集成测试失败');
    throw error;
  }

  logger.info('✅ 记忆系统测试完成');
}

async function testStorageAndConfigSystem() {
  logger.info('=== 测试存储与配置系统 (Storage & Config System) ===');

  logger.info('--- 1. Bootstrap 测试 ---');
  try {
    await bootstrap();
    const status = Bootstrap.getStatus();
    logger.info({ status }, 'Bootstrap 状态');
    logger.info('✅ Bootstrap 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ Bootstrap 测试失败');
  }

  logger.info('--- 2. PathResolver 测试 ---');
  try {
    logger.info({ basePath: pathResolver.getBasePath() }, '基础路径');
    logger.info({ configDir: pathResolver.getConfigDir() }, '配置目录');
    logger.info({ dataDir: pathResolver.getDataDir() }, '数据目录');
    logger.info({ logDir: pathResolver.getLogDir() }, '日志目录');
    logger.info({ configFile: pathResolver.getConfigFilePath() }, '配置文件路径');
    logger.info({ dataFile: pathResolver.getDataFilePath() }, '数据文件路径');
    logger.info('✅ PathResolver 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ PathResolver 测试失败');
  }

  logger.info('--- 3. ConfigManager 测试 ---');
  try {
    const config = configManager.getConfig();
    logger.info(
      {
        serverPort: config.server.port,
        serverHost: config.server.host,
        defaultModel: config.agent.default_model,
        systemPromptLength: config.agent.system_prompt.length,
      },
      '配置加载成功'
    );

    const serverConfig = configManager.getServerConfig();
    logger.info({ serverConfig }, '服务器配置');

    const agentConfig = configManager.getAgentConfig();
    logger.info({ agentConfig }, 'Agent 配置');

    const memoryConfig = configManager.getMemoryConfig();
    logger.info({ memoryConfig }, '内存配置');

    logger.info('✅ ConfigManager 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ ConfigManager 测试失败');
  }

  logger.info('--- 4. SQLiteManager 测试 ---');
  try {
    const db = sqliteManager.getDatabase();
    logger.info({ dbPath: pathResolver.getDataFilePath() }, '数据库连接成功');
    logger.info('✅ SQLiteManager 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ SQLiteManager 测试失败');
  }

  logger.info('--- 5. SessionRepository 测试 ---');
  try {
    const session = sessionRepository.create({
      chatId: 'test-chat-001',
      channelType: 'onebot',
      channelId: 'channel-123',
      userId: 'user-456',
      metadata: { source: 'test' },
    });
    logger.info({ session }, '会话创建成功');

    const found = sessionRepository.findByChatId('test-chat-001');
    logger.info({ found: !!found }, '会话查询成功');

    const updated = sessionRepository.update('test-chat-001', { userId: 'user-789' });
    logger.info({ updated: !!updated }, '会话更新成功');

    const deleted = sessionRepository.delete('test-chat-001');
    logger.info({ deleted }, '会话删除成功');

    logger.info('✅ SessionRepository 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ SessionRepository 测试失败');
  }

  logger.info('--- 6. CronJobRepository 测试 ---');
  try {
    const job = cronJobRepository.create({
      id: generateCronId(),
      chatId: 'test-chat-cron',
      name: '测试定时任务',
      cronExpression: '*/5 * * * *',
      command: '/weather',
      nextRunAt: cronJobScheduler.calculateNextRunTime('*/5 * * * *') || undefined,
    });
    logger.info({ job }, '定时任务创建成功');

    const found = cronJobRepository.findByChatId('test-chat-cron');
    logger.info({ foundCount: found.length }, '定时任务查询成功');

    const deleted = cronJobRepository.delete(job.id);
    logger.info({ deleted }, '定时任务删除成功');

    logger.info('✅ CronJobRepository 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ CronJobRepository 测试失败');
  }

  logger.info('--- 7. CronJobScheduler 测试 ---');
  try {
    const isValid = cronJobScheduler.validateCronExpression('*/5 * * * *');
    logger.info({ isValid }, 'Cron 表达式验证');

    const nextRun = cronJobScheduler.calculateNextRunTime('0 8 * * *');
    logger.info({ nextRun }, '下次运行时间计算');

    const invalidNextRun = cronJobScheduler.calculateNextRunTime('invalid');
    logger.info({ invalidNextRun }, '无效表达式处理');

    logger.info('✅ CronJobScheduler 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ CronJobScheduler 测试失败');
  }

  logger.info('--- 8. Cron 工具函数测试 ---');
  try {
    const description = parseCronDescription('0 8 * * *');
    logger.info({ description }, 'Cron 描述解析');

    const everyMinute = parseCronDescription('* * * * *');
    logger.info({ everyMinute }, '每分钟描述');

    logger.info('✅ Cron 工具函数测试通过');
  } catch (error) {
    logger.error({ error }, '❌ Cron 工具函数测试失败');
  }

  logger.info('--- 9. ConfigInjectionMiddleware 测试 ---');
  try {
    logger.info({ middlewareName: configInjectionMiddleware.name }, '中间件名称');
    logger.info('✅ ConfigInjectionMiddleware 测试通过');
  } catch (error) {
    logger.error({ error }, '❌ ConfigInjectionMiddleware 测试失败');
  }

  logger.info('--- 10. Bootstrap 关闭测试 ---');
  try {
    await shutdown();
    const statusAfter = Bootstrap.getStatus();
    logger.info({ statusAfter }, '关闭后状态');
    logger.info('✅ Bootstrap 关闭测试通过');
  } catch (error) {
    logger.error({ error }, '❌ Bootstrap 关闭测试失败');
  }

  logger.info('✅ 存储与配置系统测试完成');
}

main().catch(console.error);
