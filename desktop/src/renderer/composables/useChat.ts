/** useChat composable — 聊天状态管理。
 *
 * 管理会话、消息流、流式文本拼接、工具调用历史。
 */

import { ref } from 'vue';
import type { ChatMessageEvent } from '../../preload/index';

export type ToolCallState = {
  toolCallId: string;
  toolName: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  status: 'running' | 'done' | 'error';
  expanded: boolean;
};

export type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;
  pendingToolCalls: Map<string, ToolCallState>;
  /** 当前流式文本缓冲区 */
  streamBuffer: string;
  /** 拼好的最终回复（done 后固化） */
  lastReply: string;
};

export type ChatMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCallState[] }
  | { role: 'system'; text: string };

export function useChat(): ReturnType<typeof useChatImpl> {
  return useChatImpl();
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function useChatImpl() {
  const sessions = ref<ChatSession[]>([]);
  const activeSessionId = ref<string | null>(null);

  const activeSession = (): ChatSession | null =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null;

  function createSession(): string {
    const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.value.push({
      id,
      title: '新对话',
      messages: [],
      streaming: false,
      pendingToolCalls: new Map(),
      streamBuffer: '',
      lastReply: '',
    });
    activeSessionId.value ??= id;
    return id;
  }

  function sendMessage(text: string): void {
    let sessionId = activeSessionId.value;
    sessionId ??= createSession();

    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session) return;

    // 添加用户消息
    session.messages.push({ role: 'user', text });
    session.title = text.slice(0, 30) + (text.length > 30 ? '…' : '');
    session.streaming = true;
    session.streamBuffer = '';
    session.pendingToolCalls = new Map();

    // 发送
    void window.aesyclaw.sendChat(sessionId, text);
  }

  function handleStreamEvent(event: ChatMessageEvent): void {
    const session = sessions.value.find((s) => s.id === event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'chunk': {
        session.streamBuffer += event.text;
        break;
      }
      case 'tool_call': {
        session.pendingToolCalls.set(event.toolCallId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: 'running',
          expanded: false,
        });
        break;
      }
      case 'tool_result': {
        const tc = session.pendingToolCalls.get(event.toolCallId);
        if (tc) {
          tc.result = event.result;
          tc.isError = event.isError;
          tc.status = event.isError ? 'error' : 'done';
        }
        break;
      }
      case 'done': {
        // 固化回复
        const toolCalls = [...session.pendingToolCalls.values()];
        session.messages.push({
          role: 'assistant',
          text: session.streamBuffer,
          toolCalls,
        });
        session.streaming = false;
        session.lastReply = session.streamBuffer;
        session.streamBuffer = '';
        session.pendingToolCalls = new Map();
        break;
      }
      case 'error': {
        session.messages.push({ role: 'system', text: `错误: ${event.message}` });
        session.streaming = false;
        break;
      }
    }
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    sendMessage,
    handleStreamEvent,
  };
}
