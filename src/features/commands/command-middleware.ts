import type { ChannelContext, MiddlewareFunc } from '@/agent/types.js';
import type { CommandCatalog } from '@/features/commands/command-registry.js';
import { commandParser } from './command-parser.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';

export function createCommandMiddleware(commandCatalog: CommandCatalog): MiddlewareFunc {
  return async (ctx: ChannelContext, next: () => Promise<void>): Promise<void> => {
    const text = ctx.received.text;

    if (!text || !commandParser.isCommand(text)) {
      await next();
      return;
    }

    const parsed = commandParser.parse(text);

    if (!parsed) {
      await next();
      return;
    }

    const command = commandCatalog.getCommand(parsed.name);

    if (!command) {
      ctx.sendMessage.text = `未知的命令: /${parsed.name}\n\n输入 /help 查看可用命令`;
      ctx.sendMessage.error = `Unknown command: ${parsed.name}`;
      logger.warn(
        { commandName: parsed.name, chatId: ctx.received.chatId },
        '未知命令'
      );
      return;
    }

    logger.info(
      { commandName: command.name, chatId: ctx.received.chatId, args: parsed.args },
      '执行命令'
    );

    try {
      const result = await command.execute({
        chatId: ctx.received.chatId,
        channelId: ctx.received.channelId,
        messageType: (ctx.received.metadata?.type as string) || 'default',
        args: parsed.args,
        rawArgs: parsed.rawArgs,
      });

      ctx.sendMessage.text = result.message;

      if (!result.success) {
        ctx.sendMessage.error = result.message;
      }

      logger.info(
        { commandName: command.name, success: result.success },
        '命令执行完成'
      );
    } catch (error) {
      logger.error(
        { commandName: command.name, error },
        '命令执行失败'
      );

      ctx.sendMessage.text = `命令执行失败: ${toErrorMessage(error)}`;
      ctx.sendMessage.error = toErrorMessage(error);
    }
  };
}
