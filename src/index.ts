import { logger } from './platform/observability/logger';
import { ChannelPipeline } from './agent/core/pipeline';
import { IUnifiedMessage, IChannelContext, MiddlewareFunc } from './agent/core/types';
import { AgentManager } from './agent/core/agent-factory';

async function bootstrap() {
  logger.info('🚀 AesyClaw Agent 框架正在启动...');

  try {
    logger.debug('正在加载系统配置...');
    logger.debug('正在初始化工具注册表...');

    if (!process.env.OPENAI_API_KEY) {
      logger.warn('未检测到 OPENAI_API_KEY，部分模型可能无法使用');
    }

    logger.info('✅ 系统启动完成，开始并发测试');
    logger.info('═'.repeat(60));
    logger.info('并发轰炸测试开始：同时注入 5 个不同 chatId 的消息');
    logger.info('═'.repeat(60));

    const pipeline = new ChannelPipeline();

    const authMiddleware: MiddlewareFunc = async (ctx, next) => {
      const { senderId } = ctx.inbound;

      if (senderId === 'blocked-user') {
        logger.warn(
          { traceId: ctx.traceId, senderId },
          '🚫 AuthMiddleware：检测到被封禁用户，直接拦截'
        );
        ctx.outbound.text = '❌ 访问被拒绝：您的账号已被封禁';
        return;
      }

      logger.debug(
        { traceId: ctx.traceId, senderId },
        '🔐 AuthMiddleware：用户认证通过，继续下一层'
      );
      await next();
    };

    const rateLimitMiddleware: MiddlewareFunc = async (ctx, next) => {
      logger.debug(
        { traceId: ctx.traceId, senderId: ctx.inbound.senderId },
        '⚡ RateLimitMiddleware：检查频率限制'
      );
      await next();
    };

    const agentMiddleware: MiddlewareFunc = async (ctx, next) => {
      const { chatId, text } = ctx.inbound;

      logger.debug(
        { traceId: ctx.traceId, chatId },
        '🤖 AgentMiddleware：正在获取专属 Agent 实例'
      );

      const agentManager = AgentManager.getInstance();
      const agent = agentManager.getOrCreate(chatId);

      logger.debug(
        { traceId: ctx.traceId, chatId, instanceId: agent.getInstanceId() },
        '🤖 AgentMiddleware：Agent 实例准备就绪，开始处理'
      );

      const result = await agent.run(text);
      ctx.outbound.text = result;

      logger.debug(
        { traceId: ctx.traceId, chatId },
        '🤖 AgentMiddleware：Agent 处理完成'
      );

      await next();
    };

    const loggingMiddleware: MiddlewareFunc = async (ctx, next) => {
      logger.debug(
        { traceId: ctx.traceId },
        '📝 LoggingMiddleware：记录入站消息'
      );
      await next();
      logger.debug(
        { traceId: ctx.traceId, outbound: ctx.outbound.text },
        '📝 LoggingMiddleware：记录出站消息'
      );
    };

    pipeline.use(loggingMiddleware);
    pipeline.use(rateLimitMiddleware);
    pipeline.use(authMiddleware);
    pipeline.use(agentMiddleware);

    logger.info(
      { middlewareCount: 4 },
      '✅ 中间件链注册完成：Logging -> RateLimit -> Auth -> Agent'
    );

    const testMessages: IUnifiedMessage[] = [
      {
        channelId: 'test-channel',
        chatId: 'chat-room-001',
        senderId: 'user-Alice',
        text: '你好，我是 Alice',
      },
      {
        channelId: 'test-channel',
        chatId: 'chat-room-002',
        senderId: 'user-Bob',
        text: '你好，我是 Bob',
      },
      {
        channelId: 'test-channel',
        chatId: 'chat-room-003',
        senderId: 'blocked-user',
        text: '你好，我是坏孩子',
      },
      {
        channelId: 'test-channel',
        chatId: 'chat-room-004',
        senderId: 'user-Charlie',
        text: '你好，我是 Charlie',
      },
      {
        channelId: 'test-channel',
        chatId: 'chat-room-005',
        senderId: 'user-Diana',
        text: '你好，我是 Diana',
      },
    ];

    logger.info('═'.repeat(60));
    logger.info('🚀 开始并发注入测试请求');
    logger.info('═'.repeat(60));

    const startTime = Date.now();

    const results = await Promise.all(
      testMessages.map((msg) => pipeline.handleInbound(msg))
    );

    const totalDuration = Date.now() - startTime;

    logger.info('═'.repeat(60));
    logger.info('📊 并发测试结果汇总');
    logger.info('═'.repeat(60));

    results.forEach((ctx, index) => {
      logger.info(
        {
          index: index + 1,
          traceId: ctx.traceId,
          chatId: ctx.inbound.chatId,
          senderId: ctx.inbound.senderId,
          outbound: ctx.outbound.text,
          error: ctx.outbound.error,
        },
        `测试 ${index + 1} 完成`
      );
    });

    logger.info('═'.repeat(60));
    logger.info('✅ 并发测试全部完成');
    logger.info(`⏱️  总耗时: ${totalDuration}ms`);
    logger.info(`🤖 活跃 Agent 实例数: ${AgentManager.getInstance().getActiveAgentsCount()}`);
    logger.info('═'.repeat(60));

    const successCount = results.filter((r) => !r.outbound.error).length;
    const blockedCount = results.filter((r) =>
      r.outbound.text.includes('封禁')
    ).length;

    logger.info(`📈 成功: ${successCount}, 拦截: ${blockedCount}, 总计: ${results.length}`);
    logger.info('🎉 所有测试用例已执行完毕');
    logger.info('═'.repeat(60));

  } catch (error) {
    logger.error({ err: error }, '系统启动失败');
    process.exit(1);
  }
}

bootstrap();
