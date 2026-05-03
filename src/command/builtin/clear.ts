/**
 * 内置 clear 命令。
 *
 * 清除会话历史。
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { SessionManager } from '../../agent/session-manager';

export type ClearCommandDeps = {
  sessionManager: Pick<SessionManager, 'clearSession'>;
};

/**
 * 创建 clear 命令定义。
 *
 * @param deps - 包含 sessionManager 的依赖项
 * @returns clear 命令的 CommandDefinition
 */
export function createClearCommand(deps: ClearCommandDeps): CommandDefinition {
  return {
    name: 'clear',
    description: '清除当前会话历史',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await deps.sessionManager.clearSession(context.sessionKey);
      return '当前会话历史已清除。';
    },
  };
}
