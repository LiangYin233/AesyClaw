/**
 * 命令检测 — 检测并执行斜杠命令。
 *
 * 如果入站消息内容以 "/" 开头并匹配已注册的
 * 命令，则此步骤执行它并设置出站响应。
 * 命令处理是终止性的 — 当设置了出站消息时，管道
 * 跳过后续步骤（如 Agent 处理）。
 */

import type { PipelineState } from './types';
import type { CommandRegistry } from '../../command/command-registry';
import type { CommandContext } from '../../core/types';
import {
  AGENT_PROCESSING_BUSY_MESSAGE,
  type SessionManager,
} from '../../agent/session-manager';

/**
 * 检测斜杠命令并通过 CommandRegistry 执行它们。
 *
 * 命令是面向用户的功能，如 /help、/role list 等。
 * 当检测到命令时，此函数：
 * 1. 从管道状态创建 CommandContext
 * 2. 通过 CommandRegistry 执行命令
 * 3. 在状态上设置出站响应
 * 4. 返回状态 — 管道应跳过剩余步骤
 */
export async function commandDetector(
  state: PipelineState,
  commandRegistry: CommandRegistry,
  sessionManager: Pick<SessionManager, 'isAgentProcessing'>,
): Promise<PipelineState> {
  const resolved = commandRegistry.resolve(state.inbound.content);
  const isBusy = sessionManager.isAgentProcessing(state.inbound.sessionKey);

  if (isBusy && (!resolved || !resolved.command.allowDuringAgentProcessing)) {
    state.outbound = { content: AGENT_PROCESSING_BUSY_MESSAGE };
    return state;
  }

  if (!resolved) {
    return state;
  }

  const commandContext: CommandContext = {
    sessionKey: state.inbound.sessionKey,
  };

  const result = await commandRegistry.executeResolved(resolved, commandContext);
  state.outbound = { content: result };

  return state;
}
