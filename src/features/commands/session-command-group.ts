import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import {
  clearSessionById,
  compactSessionForCommandContext,
} from '@/agent/session/session-runtime.js';

export const sessionCommandGroup: CommandDefinition[] = [
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
          clearSessionById(ctx);
          return {
            success: true,
            message: '会话历史已清除',
          };
        }

        case 'compact': {
          return await compactSessionForCommandContext(ctx);
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /session clear   - 清除当前会话\n  /session compact - 压缩当前会话`,
          };
        }
      }
    },
  },
];
