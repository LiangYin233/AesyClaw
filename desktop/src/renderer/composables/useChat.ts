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
  /** 当前正在累积的 assistant 文本消息 */
  activeAssistantMessage: AssistantMessage | null;
};

export type ChatMessage =
  | { role: 'user'; text: string }
  | AssistantMessage
  | ToolMessage
  | { role: 'system'; text: string };

export type AssistantMessage = {
  role: 'assistant';
  text: string;
  streaming: boolean;
};

export type ToolMessage = {
  role: 'tool';
  toolCall: ToolCallState;
};

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
      activeAssistantMessage: null,
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
    session.pendingToolCalls = new Map();
    session.activeAssistantMessage = null;

    // 发送
    void window.aesyclaw.sendChat(sessionId, text);
  }

  function handleStreamEvent(event: ChatMessageEvent): void {
    const session = sessions.value.find((s) => s.id === event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'chunk': {
        appendAssistantChunk(session, event.text);
        break;
      }
      case 'tool_call': {
        const toolCall: ToolCallState = {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.args,
          status: 'running',
          expanded: false,
        };
        session.pendingToolCalls.set(event.toolCallId, toolCall);
        session.messages.push({ role: 'tool', toolCall });
        session.activeAssistantMessage = null;
        break;
      }
      case 'tool_result': {
        const tc = session.pendingToolCalls.get(event.toolCallId);
        if (tc) {
          tc.result = event.result;
          tc.isError = event.isError;
          tc.status = event.isError ? 'error' : 'done';
        }
        session.activeAssistantMessage = null;
        break;
      }
      case 'done': {
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
        }
        session.streaming = false;
        session.activeAssistantMessage = null;
        session.pendingToolCalls = new Map();
        break;
      }
      case 'error': {
        session.messages.push({ role: 'system', text: `错误: ${event.message}` });
        session.streaming = false;
        session.activeAssistantMessage = null;
        break;
      }
    }
  }

  function appendAssistantChunk(session: ChatSession, text: string): void {
    if (!session.activeAssistantMessage) {
      session.activeAssistantMessage = {
        role: 'assistant',
        text: '',
        streaming: true,
      };
      session.messages.push(session.activeAssistantMessage);
    }
    session.activeAssistantMessage.text += text;
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
