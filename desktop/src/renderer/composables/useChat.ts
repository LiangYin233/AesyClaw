/** useChat composable — 聊天状态管理。
 *
 * 管理会话、消息流、流式文本拼接、工具调用历史。
 */

import { ref } from 'vue';
import { makeSessionTitle, stripInformationTags } from '../utils/title';
import type {
  ChatMessageEvent,
  DesktopHistoryMessage,
  DesktopSessionSummary,
  DesktopUploadFile,
  DesktopUsage,
} from '../../preload/index';

/** 从后端历史消息的 content 文本中解析 [Attachments] 块，返回纯文本和结构化附件列表。 */
function parseAttachmentsFromText(content: string): {
  text: string;
  attachments?: ChatAttachment[];
} {
  const ATTACHMENTS_HEADER = '[Attachments]';
  const headerIndex = content.indexOf(ATTACHMENTS_HEADER);
  if (headerIndex === -1) {
    return { text: content };
  }

  const text = content.slice(0, headerIndex).trimEnd();
  const block = content.slice(headerIndex + ATTACHMENTS_HEADER.length).trim();
  const lines = block.split('\n').filter((l) => l.trim().startsWith('- '));

  const attachments: ChatAttachment[] = [];
  for (const line of lines) {
    // 格式: "- kind: filePath (fileName, mimeType)"
    const match = line.match(/\(([^)]+),\s*([^)]+)\)$/);
    if (match) {
      attachments.push({
        name: match[1].trim(),
        mime: match[2].trim(),
        size: 0, // 历史消息不包含文件大小
      });
    }
  }

  return {
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

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
  | UserMessage
  | AssistantMessage
  | ToolMessage
  | { role: 'system'; text: string };

export type UserMessage = {
  role: 'user';
  text: string;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  name: string;
  mime: string;
  size: number;
};
export type AssistantMessage = {
  role: 'assistant';
  text: string;
  streaming: boolean;
  isIntermediate?: boolean; // tool call 之间的片段文本，非最终回复
  usage?: DesktopUsage;
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
  const lastBackendSummaries = new Map<string, DesktopSessionSummary>();

  const activeSession = (): ChatSession | null =>
    sessions.value.find((s) => s.id === activeSessionId.value) ?? null;

  function createSession(): string {
    const id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.value.push(createEmptySession(id, '新对话'));
    activeSessionId.value = id;
    return id;
  }

  async function syncSessionsFromBackend(): Promise<void> {
    const response = await window.aesyclaw.adminRequest('get_sessions');
    if (!response.ok || !Array.isArray(response.data)) return;

    const summaries = (response.data as DesktopSessionSummary[]).filter(
      (session) => session.channel === 'desktop',
    );
    lastBackendSummaries.clear();
    for (const summary of summaries) {
      lastBackendSummaries.set(summary.chatId, summary);
    }
    const existing = new Map(sessions.value.map((session) => [session.id, session]));
    const synced: ChatSession[] = [];

    for (const summary of summaries) {
      const local =
        existing.get(summary.chatId) ??
        createEmptySession(summary.chatId, getSessionTitle(summary));
      local.title = getSessionTitle(summary);
      synced.push(local);
      existing.delete(summary.chatId);
    }

    for (const local of existing.values()) {
      if (shouldKeepLocalSession(local)) {
        synced.push(local);
      }
    }

    sessions.value = synced;
    if (
      activeSessionId.value &&
      !sessions.value.some((session) => session.id === activeSessionId.value)
    ) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
    } else {
      activeSessionId.value ??= sessions.value[0]?.id ?? null;
    }
  }

  async function loadSessionMessages(sessionId: string): Promise<void> {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session || session.streaming || session.messages.length > 0) return;
    const summary = findBackendSummary(sessionId);
    if (!summary) return;

    const response = await window.aesyclaw.adminRequest('get_messages', { sessionId: summary.id });
    if (!response.ok || !Array.isArray(response.data)) return;

    session.messages = (response.data as DesktopHistoryMessage[]).map(
      (message): UserMessage | AssistantMessage => {
        const { text, attachments } = parseAttachmentsFromText(message.content);
        const cleanText = stripInformationTags(text);
        return message.role === 'assistant'
          ? { role: 'assistant', text: cleanText, streaming: false, usage: message.usage }
          : { role: 'user', text: cleanText, attachments };
      },
    );
    session.activeAssistantMessage = null;
  }

  function sendMessage(
    text: string,
    files: DesktopUploadFile[] = [],
    attachments: ChatAttachment[] = files.map(({ name, mime, size }) => ({ name, mime, size })),
  ): void {
    if (text.trim().length === 0 && files.length === 0) return;

    let sessionId = activeSessionId.value;
    sessionId ??= createSession();

    const session = sessions.value.find((s) => s.id === sessionId);
    if (!session) return;
    const outboundSessionId = session.id;
    const trimmedText = text.trim();
    const titleText = trimmedText.length > 0 ? trimmedText : (attachments[0]?.name ?? '新对话');

    // 添加用户消息
    session.messages.push({ role: 'user', text, attachments });
    session.title = makeSessionTitle(titleText, '新对话');
    session.streaming = true;
    session.pendingToolCalls = new Map();
    session.activeAssistantMessage = null;

    // 发送
    void window.aesyclaw.sendChat(outboundSessionId, text, files);
  }

  function handleStreamEvent(event: ChatMessageEvent): void {
    const session = findSessionForEvent(event);
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
        // 标记为中间态并关闭流式状态
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
          session.activeAssistantMessage.isIntermediate = true;
        }
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
        // 标记为中间态并关闭流式状态
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
          session.activeAssistantMessage.isIntermediate = true;
        }
        session.activeAssistantMessage = null;
        break;
      }
      case 'done': {
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
          session.activeAssistantMessage.usage = event.usage;
        }
        session.streaming = false;
        session.activeAssistantMessage = null;
        session.pendingToolCalls = new Map();
        break;
      }
      case 'error': {
        session.messages.push({ role: 'system', text: `错误: ${event.message}` });
        session.streaming = false;
        // 关闭前一条助理消息的流式状态
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
        }
        session.activeAssistantMessage = null;
        break;
      }
    }
  }

  function createEmptySession(id: string, title: string): ChatSession {
    return {
      id,
      title,
      messages: [],
      streaming: false,
      pendingToolCalls: new Map(),
      activeAssistantMessage: null,
    };
  }

  function getSessionTitle(summary: DesktopSessionSummary): string {
    return makeSessionTitle(
      summary.firstUserMessage ?? summary.title ?? summary.chatId ?? summary.id,
      summary.chatId ?? summary.id,
    );
  }

  function findBackendSummary(chatId: string): DesktopSessionSummary | null {
    return lastBackendSummaries.get(chatId) ?? null;
  }

  function shouldKeepLocalSession(session: ChatSession): boolean {
    return session.streaming || session.messages.length > 0 || session.id === activeSessionId.value;
  }

  function findSessionForEvent(event: ChatMessageEvent): ChatSession | null {
    const session = sessions.value.find((s) => s.id === event.sessionId);
    if (session) return session;
    return null;
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
    syncSessionsFromBackend,
    loadSessionMessages,
    sendMessage,
    handleStreamEvent,
  };
}
