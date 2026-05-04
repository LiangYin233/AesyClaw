/**
 * 内置 clear 命令。
 *
 * 清除会话历史。
 *
 */

import type { CommandDefinition, CommandContext } from '@aesyclaw/core/types';
import type { SessionManager } from '@aesyclaw/agent/session-manager';

/**
 * 创建 clear 命令定义。
 *
 * @returns clear 命令的 CommandDefinition
 */
export function createClearCommand(
  sessionManager: Pick<SessionManager, 'clearSession'>,
): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await sessionManager.clearSession(context.sessionKey);
      return '当前会话历史已清除。';
    },
  };
}
