/**
 * 内置 compact 命令。
 *
 * 压缩会话历史以减少上下文长度。
 *
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { SessionManager } from '../../agent/session-manager';

export type CompactCommandDeps = {
  sessionManager: Pick<SessionManager, 'compactSession'>;
}

/**
 * 创建 compact 命令定义。
 *
 * @param deps - 包含 sessionManager 的依赖项
 * @returns compact 命令的 CommandDefinition
 */
export function createCompactCommand(deps: CompactCommandDeps): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      await deps.sessionManager.compactSession(context.sessionKey);
      return '会话已压缩完成。';
    },
  };
}
