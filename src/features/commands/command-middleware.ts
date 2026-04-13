import { MiddlewareFunc } from '../../agent/types.js';
import { IChannelContext } from '../../agent/types.js';
import { commandParser } from './command-parser.js';
import { commandRegistry } from './command-registry.js';
import { logger } from '../../platform/observability/logger.js';

export const commandMiddleware: MiddlewareFunc = async (
  ctx: IChannelContext,
  next: () => Promise<void>
): Promise<void> => {
  const text = ctx.inbound.text;

  if (!text || !commandParser.isCommand(text)) {
    await next();
    return;
  }

  const parsed = commandParser.parse(text);

  if (!parsed) {
    await next();
    return;
  }

  const command = commandRegistry.getCommand(parsed.name);

  if (!command) {
    ctx.outbound.text = `未知的命令: /${parsed.name}\n\n输入 /help 查看可用命令`;
    ctx.outbound.error = `Unknown command: ${parsed.name}`;
    logger.warn(
      { commandName: parsed.name, chatId: ctx.inbound.chatId },
      '❌ 未知命令'
    );
    return;
  }

  logger.info(
    { commandName: command.name, chatId: ctx.inbound.chatId, args: parsed.args },
    '执行命令'
  );

  try {
    const result = await command.execute({
      chatId: ctx.inbound.chatId,
      channelId: ctx.inbound.channelId,
      messageType: (ctx.inbound.metadata?.type as string) || 'default',
      args: parsed.args,
      rawArgs: parsed.rawArgs,
      traceId: ctx.traceId,
    });

    ctx.outbound.text = result.message;

    if (!result.success) {
      ctx.outbound.error = result.message;
    }

    logger.info(
      { commandName: command.name, success: result.success },
      '命令执行完成'
    );
  } catch (error) {
    logger.error(
      { commandName: command.name, error },
      '❌ 命令执行失败'
    );

    ctx.outbound.text = `命令执行失败: ${error instanceof Error ? error.message : '未知错误'}`;
    ctx.outbound.error = error instanceof Error ? error.message : String(error);
  }
};
