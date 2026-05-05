/**
 * 命令检测 — 检测并执行斜杠命令。
 *
 * 如果入站消息内容以 "/" 开头并匹配已注册的
 * 命令，则此步骤执行它并设置出站响应。
 * 命令处理是终止性的 — 当设置了出站消息时，管道
 * 跳过后续步骤（如 Agent 处理）。
 */

import type { PipelineState } from './types';
import type { CommandRegistry } from '@aesyclaw/command/command-registry';
import type { CommandContext } from '@aesyclaw/core/types';
import { getMessageText } from '@aesyclaw/core/types';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '@aesyclaw/agent/session';

export async function commandDetector(
  state: PipelineState,
  commandRegistry: CommandRegistry,
): Promise<PipelineState> {
  if (state.stage !== 'continue') {
    return state;
  }

  const resolved = commandRegistry.resolve(getMessageText(state.inbound));
  const isBusy = state.session?.isLocked ?? false;

  if (isBusy && !resolved?.command.allowDuringAgentProcessing) {
    return {
      ...state,
      stage: 'respond',
      outbound: { components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }] },
    };
  }

  if (!resolved) {
    return state;
  }

  const commandContext: CommandContext = {
    sessionKey: state.sessionKey,
  };

  const result = await commandRegistry.executeResolved(resolved, commandContext);
  return {
    ...state,
    stage: 'respond',
    outbound: { components: [{ type: 'Plain', text: result }] },
  };
}
