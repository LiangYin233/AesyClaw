import { logger } from './platform/observability/logger';

async function bootstrap() {
  logger.info('🚀 AesyClaw Agent 框架正在启动...');
  
  try {
    logger.debug('正在加载系统配置...');
    logger.debug('正在初始化工具注册表...');
    
    if (!process.env.OPENAI_API_KEY) {
      logger.warn('未检测到 OPENAI_API_KEY，部分模型可能无法使用');
    }

    logger.info('✅ 系统启动完成，等待接收外部触发事件');
    
  } catch (error) {
    logger.error({ err: error }, '系统启动失败');
    process.exit(1);
  }
}

bootstrap();
