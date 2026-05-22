/**
 * runner/event-converter — Agent 事件转换。
 *
 * 将 PiAgent 原始事件 (AgentEvent) 转换为内部 StreamEventMeta，
 * 再将 StreamEventMeta 转换为对外投递的 StreamMessage。
 */

import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { StreamEventMeta, StreamMessage } from '@aesyclaw/core/types/stream';
import { getFinalAssistantUsage } from './run-parser';

/**
 * 将 pi-agent-core AgentEvent 转换为 StreamEventMeta。
 * 不需要关注的事件返回 null。
 */
export function convertAgentEvent(event: AgentEvent, chunkIndex: number): StreamEventMeta | null {
  switch (event.type) {
    case 'message_update': {
      const ae = event.assistantMessageEvent;
      if (ae.type !== 'text_delta') return null;
      const text = ae.delta;
      if (text.length === 0) return null;
      return { type: 'chunk', text, chunkIndex };
    }
    case 'tool_execution_start':
      return {
        type: 'toolCall',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
      };
    case 'tool_execution_end':
      return {
        type: 'toolResult',
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    case 'agent_end':
      return { type: 'done', usage: getFinalAssistantUsage(event.messages) };
    default:
      return null;
  }
}

/**
 * 将 StreamEventMeta 转换为对外投递的 StreamMessage。
 */
export function streamEventMetaToMessage(meta: StreamEventMeta): StreamMessage {
  switch (meta.type) {
    case 'chunk':
      return {
        components: [{ type: 'Plain', text: meta.text ?? '' }],
        event: 'chunk',
        chunkIndex: meta.chunkIndex,
      };
    case 'toolCall':
      return {
        components: [],
        event: 'toolCall',
        toolCallId: meta.toolCallId,
        toolName: meta.toolName,
        args: meta.args,
      };
    case 'toolResult':
      return {
        components: [],
        event: 'toolResult',
        toolCallId: meta.toolCallId,
        toolName: meta.toolName,
        result: meta.result,
        isError: meta.isError,
      };
    case 'done':
      return {
        components: [],
        event: 'done',
        usage: meta.usage,
      };
  }
}
