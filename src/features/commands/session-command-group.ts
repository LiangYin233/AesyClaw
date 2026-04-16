import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import {
  clearSessionById,
  getSessionForCommandContext,
  getSessionSummaries,
} from '@/agent/session/session-runtime.js';

export const sessionCommandGroup: CommandDefinition[] = [
  {
    name: 'session',
    description: '会话管理命令',
    usage: '/session <list|clear>',
    category: 'system',
    aliases: ['sess'],
    execute: async (ctx: CommandContext): Promise<CommandResult> => {
      const subCommand = ctx.args[0]?.toLowerCase();

      switch (subCommand) {
        case 'list': {
          const summaries = getSessionSummaries();
          if (summaries.length === 0) {
            return {
              success: true,
              message: '暂无会话记录',
            };
          }

          let output = '会话列表：\n\n';
          for (const summary of summaries) {
            const { id, channel, type, chatId, messageCount, updatedAt } = summary.session;
            output += `${id}\n`;
            output += `  - 范围: ${channel}:${type}:${chatId}\n`;
            output += `  - 消息数: ${messageCount}\n`;
            output += `  - 最后活跃: ${updatedAt.toLocaleString()}\n`;
            output += `  - 状态: ${summary.isCurrent ? '当前会话' : '历史会话'}\n\n`;
          }

          return {
            success: true,
            message: output.trim(),
          };
        }

        case 'clear': {
          const session = getSessionForCommandContext(ctx);
          if (!session) {
            return {
              success: false,
              message: '会话不存在',
            };
          }

          clearSessionById(session.session.id);
          return {
            success: true,
            message: '会话历史已清除',
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /session list  - 列出所有会话\n  /session clear - 清除当前会话`,
          };
        }
      }
    },
  },
];
