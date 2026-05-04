/**
 * 内置 compact 命令。
 *
 * 压缩会话历史以减少上下文长度。
 *
 */

import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session-manager';

/**
 * 创建 compact 命令定义。
 *
 * @returns compact 命令的 CommandDefinition
 */
export function createCompactCommand(
  sessionManager: Pick<SessionManager, 'compactSession'>,
): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await sessionManager.compactSession(context.sessionKey);
      return '会话已压缩完成。';
    },
  };
}
