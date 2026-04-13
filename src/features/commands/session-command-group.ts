import type { CommandContext, CommandDefinition, CommandResult } from '@/contracts/commands.js';
import {
  clearSessionById,
  getSessionForCommandContext,
  getSessionStats,
  getSessionSummaries,
} from '@/agent/session/session-runtime.js';

export const sessionCommandGroup: CommandDefinition[] = [
  {
    name: 'session',
    description: '会话管理命令',
    usage: '/session <list|clear|stats>',
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
              message: '暂无活动会话',
            };
          }

          let output = '活动会话列表：\n\n';
          for (const summary of summaries) {
            const { channel, type, chatId, session: sessionPart } = summary.metadata;
            output += `${channel}:${type}:${chatId}:${sessionPart}\n`;
            output += `  - 消息数: ${summary.metadata.messageCount}\n`;
            output += `  - 最后活跃: ${summary.metadata.lastActiveAt.toLocaleString()}\n\n`;
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

          clearSessionById(session.metadata.sessionId);
          return {
            success: true,
            message: '会话历史已清除',
          };
        }

        case 'stats': {
          const stats = getSessionStats();
          let output = ' 会话统计：\n\n';
          output += `总会话数: ${stats.total}\n\n`;
          output += '按渠道:\n';
          for (const [channel, count] of Object.entries(stats.byChannel)) {
            output += `  - ${channel}: ${count}\n`;
          }
          output += '\n按类型:\n';
          for (const [type, count] of Object.entries(stats.byType)) {
            output += `  - ${type}: ${count}\n`;
          }

          return {
            success: true,
            message: output.trim(),
          };
        }

        default: {
          return {
            success: false,
            message: `未知子命令: ${subCommand || '(无)'}\n\n可用子命令:\n  /session list   - 列出所有会话\n  /session clear - 清除当前会话\n  /session stats - 查看会话统计`,
          };
        }
      }
    },
  },
];
