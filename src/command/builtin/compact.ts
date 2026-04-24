/**
 * Built-in compact command.
 *
 * Compacts session history to reduce context size.
 *
 * @see project.md §5.9
 */

import type { CommandDefinition, CommandContext } from '../../core/types';
import type { SessionManager } from '../../agent/session-manager';

export interface CompactCommandDeps {
  sessionManager: Pick<SessionManager, 'compactSession'>;
}

export function createCompactCommand(deps: CompactCommandDeps): CommandDefinition {
  return {
    name: 'compact',
    description: '压缩当前会话历史以减少上下文长度',
    scope: 'system',
    execute: async (_args: string[], context: CommandContext): Promise<string> => {
      const summary = await deps.sessionManager.compactSession(context.sessionKey);
      return summary.length > 0 ? `当前会话已压缩：\n${summary}` : '当前会话已压缩。';
    },
  };
}
