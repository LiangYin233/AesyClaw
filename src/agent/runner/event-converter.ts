/**
 * runner/event-converter — Agent 事件 → OutboundSignal 转换。
 */

import type { AgentEvent } from '@earendil-works/pi-agent-core';
import type { OutboundSignal, SessionKey } from '@aesyclaw/core/types';
import { getFinalAssistantUsage } from './run-parser';

/**
 * 将 pi-agent-core AgentEvent 转换为 OutboundSignal。
 * 不需要关注的事件返回 null。
 */
export function convertAgentEvent(
  event: AgentEvent,
  chunkIndex: number,
  session: SessionKey,
): OutboundSignal | null {
  switch (event.type) {
    case 'message_update': {
      const ae = event.assistantMessageEvent;
      if (ae.type !== 'text_delta') return null;
      const text = ae.delta;
      if (text.length === 0) return null;
      return { kind: 'chunk', session, text, index: chunkIndex };
    }
    case 'tool_execution_start':
      return {
        kind: 'toolCall',
        session,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case 'tool_execution_end':
      return {
        kind: 'toolResult',
        session,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case 'agent_end':
      return { kind: 'done', session, usage: getFinalAssistantUsage(event.messages) };
    default:
      return null;
  }
}
