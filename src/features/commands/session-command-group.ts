import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import type { ChatService } from '@/agent/session/session-service.js';
import { createUnknownSubcommandResult } from '@/platform/commands/subcommand-utils.js';

const SESSION_SUBCOMMANDS = [
  '  /session clear   - 清除当前会话',
  '  /session compact - 压缩当前会话',
];

export function createSessionCommandGroup(chatService: ChatService): CommandDefinition[] {
  return [
    {
      name: 'session',
      description: '会话管理命令',
      usage: '/session <clear|compact>',
      category: 'system',
      aliases: ['sess'],
      execute: async (ctx: CommandContext): Promise<CommandResult> => {
        const subCommand = ctx.args[0]?.toLowerCase();

        switch (subCommand) {
          case 'clear': {
            chatService.clearChat(ctx);
            return {
              success: true,
              message: '会话历史已清除',
            };
          }

          case 'compact': {
            return await chatService.compactChat(ctx);
          }

          default: {
            return createUnknownSubcommandResult(subCommand, SESSION_SUBCOMMANDS);
          }
        }
      },
    },
  ];
}
