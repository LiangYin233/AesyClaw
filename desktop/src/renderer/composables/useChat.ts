/** useChat composable — 聊天状态管理。
 *
 * 管理会话、消息流、流式文本拼接、工具调用历史。
 */

import { computed, ref } from 'vue';
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
    // 格式: "- kind: path (name, mimeType)"
    const match = line.match(/^- \w+:\s+(.+)\s+\(([^)]+),\s*([^)]+)\)$/);
    if (match?.[1] && match[2] && match[3]) {
      attachments.push({
        name: match[2].trim(),
        mime: match[3].trim(),
        size: 0,
        path: match[1].trim(),
      });
    }
  }

  return {
    text,
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function attachmentsToMedia(attachments: ChatAttachment[] | undefined): MediaItem[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((a) => ({
    kind: mimeKind(a.mime),
    name: a.name,
    mimeType: a.mime,
    localPath: a.path,
  }));
}

function mimeKind(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
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
  /** 正在加载历史消息 */
  isLoading?: boolean;
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
  path?: string;
};
export type MediaItem = {
  kind: string;
  base64?: string;
  mimeType?: string;
  name?: string;
  localPath?: string;
};
export type AssistantMessage = {
  role: 'assistant';
  text: string;
  streaming: boolean;
  isIntermediate?: boolean; // tool call 之间的片段文本，非最终回复
  usage?: DesktopUsage;
  media?: MediaItem[];
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
  const pendingDeletedSessions = new Map<string, { confirmed: boolean }>();
  const pendingChannelRequests = new Map<string, (data: unknown) => void>();
  const responseTypeMap: Record<string, string> = {
    get_sessions: 'sessions',
    get_session_messages: 'session_messages',
  };

  /** 通过 chat WebSocket 发送请求并等待响应事件 */
  async function channelRequest(type: string, payload?: Record<string, unknown>): Promise<unknown> {
    const responseType = responseTypeMap[type] ?? type;
    const sent = await window.aesyclaw.sendChatRaw(type, (payload?.['sessionId'] as string) ?? '');
    if (!sent) return [];
    return new Promise((resolve) => {
      const key = `${responseType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      pendingChannelRequests.set(key, resolve);
      setTimeout(() => {
        pendingChannelRequests.delete(key);
        resolve([]);
      }, 10000);
    });
  }

  /** 处理来自 chat WebSocket 的响应事件 */
  function handleChannelResponse(
    type: string,
    _sessionId: string | undefined,
    data: unknown,
  ): void {
    let resolved = false;
    for (const [key, resolve] of pendingChannelRequests) {
      if (key.startsWith(type + ':')) {
        pendingChannelRequests.delete(key);
        resolve(data);
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      // 无等待请求时，触发被动同步（如 compact 后自动刷新）
      if (type === 'sessions') void syncSessionsFromBackend();
    }
  }
  const activeSession = computed(
    (): ChatSession | null => sessions.value.find((s) => s.id === activeSessionId.value) ?? null,
  );

  function createSession(): string {
    const id = `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessions.value.push(createEmptySession(id, '新对话'));
    activeSessionId.value = id;
    return id;
  }

  async function syncSessionsFromBackend(): Promise<void> {
    const raw = await channelRequest('get_sessions');
    if (!Array.isArray(raw)) return;
    const summaries = (raw as DesktopSessionSummary[]).filter(
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
      // 仅当后端摘要含有实际消息内容时才覆盖本地标题，
      // 避免空会话的标题被回退为 desktop-xxx
      if (summary.firstUserMessage) {
        local.title = getSessionTitle(summary);
      }
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

  async function loadSessionMessages(sessionId: string, force = false): Promise<void> {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session || session.streaming) return;
    if (!force && session.messages.length > 0) return;
    const summary = findBackendSummary(sessionId);
    if (!summary) return;
    session.isLoading = true;
    const raw = (await channelRequest('get_session_messages', {
      sessionId,
    })) as DesktopHistoryMessage[];
    session.isLoading = false;
    if (!Array.isArray(raw)) return;
    const converted: ChatMessage[] = [];
    // 用于 toolResult 匹配 toolCall：key=toolCallId, value=ToolCallState 对象引用
    const toolCallIndex = new Map<string, ToolCallState>();

    for (const message of raw) {
      if (message.role === 'user') {
        const { text, attachments } = parseAttachmentsFromText(message.content);
        converted.push({ role: 'user', text: stripInformationTags(text), attachments });
        continue;
      }

      if (message.role === 'assistant') {
        const { text, attachments } = parseAttachmentsFromText(message.content);
        const cleanText = stripInformationTags(text);
        // 纯文本 assistant
        if (!message.toolData) {
          converted.push({
            role: 'assistant',
            text: cleanText,
            streaming: false,
            usage: message.usage,
            media: attachmentsToMedia(attachments),
          });
          continue;
        }
        // 含 toolCall 的 assistant
        if (cleanText) {
          converted.push({
            role: 'assistant',
            text: cleanText,
            streaming: false,
            usage: message.usage,
          });
        }
        // 为每个工具调用创建卡片，注册到索引中，待 toolResult 更新
        parseToolCallsFromData(message.toolData).forEach((tc) => {
          const card: ToolMessage = { role: 'tool', toolCall: tc };
          converted.push(card);
          toolCallIndex.set(tc.toolCallId, tc);
        });
        continue;
      }

      if (message.role === 'toolResult') {
        const tc = parseToolResultFromData(message.toolData, message.content);
        // 通过 toolCallId 匹配已有的调用卡片，合并结果
        const existing = toolCallIndex.get(tc.toolCallId);
        if (existing) {
          existing.result = tc.result;
          existing.isError = tc.isError;
          existing.status = tc.status;
        } else {
          // 无对应调用（如旧数据），独立显示结果卡片
          converted.push({ role: 'tool', toolCall: tc });
        }
      }
    }

    session.messages = converted;
    session.activeAssistantMessage = null;
  }

  async function sendMessage(
    text: string,
    files: DesktopUploadFile[] = [],
    attachments: ChatAttachment[] = files.map(({ name, mime, size }) => ({ name, mime, size })),
  ): Promise<void> {
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
    if (isClearDeleteCommand(trimmedText)) {
      pendingDeletedSessions.set(outboundSessionId, { confirmed: false });
    }

    try {
      const sent = await window.aesyclaw.sendChat(outboundSessionId, text, files);
      if (!sent) {
        markSendFailure(session, '消息发送失败：聊天连接未建立');
        pendingDeletedSessions.delete(outboundSessionId);
      }
    } catch (error) {
      markSendFailure(session, `消息发送失败：${formatErrorMessage(error)}`);
      pendingDeletedSessions.delete(outboundSessionId);
    }
  }

  function markSendFailure(session: ChatSession, message: string): void {
    session.streaming = false;
    session.pendingToolCalls = new Map();
    if (session.activeAssistantMessage) {
      session.activeAssistantMessage.streaming = false;
    }
    session.activeAssistantMessage = null;
    session.messages.push({ role: 'system', text: message });
  }

  function formatErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function handleStreamEvent(event: ChatMessageEvent): void {
    const session = findSessionForEvent(event);
    if (!session) return;

    switch (event.type) {
      case 'chunk': {
        appendAssistantChunk(session, event.text);
        markDeleteConfirmedIfNeeded(session, event.text);
        break;
      }
      case 'media': {
        if (event.text) {
          appendAssistantChunk(session, event.text);
        }
        if (!session.activeAssistantMessage) {
          session.activeAssistantMessage = {
            role: 'assistant',
            text: '',
            streaming: true,
          };
          session.messages.push(session.activeAssistantMessage);
        }
        session.activeAssistantMessage.media = event.items as MediaItem[];
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
        if (session.activeAssistantMessage) {
          session.activeAssistantMessage.streaming = false;
          if (event.toolName !== 'send_msg') {
            session.activeAssistantMessage.isIntermediate = true;
          }
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
        const pendingDelete = pendingDeletedSessions.get(session.id);
        pendingDeletedSessions.delete(session.id);
        if (pendingDelete?.confirmed) {
          removeSessionLocally(session.id);
        }
        break;
      }
      case 'error': {
        session.messages.push({ role: 'system', text: `错误: ${event.message}` });
        session.streaming = false;
        session.pendingToolCalls = new Map();
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
      isLoading: false,
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

  function isClearDeleteCommand(text: string): boolean {
    return /^\/clear\s+delete\s*$/i.test(text);
  }

  function markDeleteConfirmedIfNeeded(session: ChatSession, text: string): void {
    const pendingDelete = pendingDeletedSessions.get(session.id);
    if (pendingDelete && text.includes('当前会话已删除')) {
      pendingDelete.confirmed = true;
    }
  }

  function removeSessionLocally(sessionId: string): void {
    sessions.value = sessions.value.filter((session) => session.id !== sessionId);
    if (activeSessionId.value === sessionId) {
      activeSessionId.value = sessions.value[0]?.id ?? null;
    }
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

  // ── 历史消息工具数据解析 ──────────────────────────────────

  /** 从 assistant 消息的 toolData 中解析 ToolCallState 列表（兼容新旧格式） */
  function parseToolCallsFromData(toolData: string): ToolCallState[] {
    try {
      const parsed = JSON.parse(toolData);
      const calls: Array<{ id?: string; name: string; arguments?: Record<string, unknown> }> =
        Array.isArray(parsed)
          ? parsed
          : ((
              parsed as {
                toolCalls?: Array<{
                  id?: string;
                  name: string;
                  arguments?: Record<string, unknown>;
                }>;
              }
            ).toolCalls ?? []);
      return calls.map((tc) => ({
        toolCallId: tc.id ?? '',
        toolName: tc.name,
        args: tc.arguments ?? {},
        status: 'done' as const,
        expanded: false,
      }));
    } catch {
      return [];
    }
  }

  /** 从 toolResult 消息的 toolData 中解析 ToolCallState */
  function parseToolResultFromData(toolData: string | undefined, content: string): ToolCallState {
    if (!toolData) {
      return {
        toolCallId: '',
        toolName: '',
        args: {},
        result: content,
        status: 'done',
        expanded: false,
      };
    }
    try {
      const parsed = JSON.parse(toolData) as {
        toolCallId?: string;
        toolName?: string;
        isError?: boolean;
      };
      return {
        toolCallId: parsed.toolCallId ?? '',
        toolName: parsed.toolName ?? '',
        args: {},
        result: content,
        isError: parsed.isError,
        status: parsed.isError ? 'error' : 'done',
        expanded: false,
      };
    } catch {
      return {
        toolCallId: '',
        toolName: '',
        args: {},
        result: content,
        status: 'done',
        expanded: false,
      };
    }
  }

  /** 强制重新加载指定会话的消息（清空缓存后从后端拉取） */
  async function reloadSessionMessages(sessionId: string): Promise<void> {
    const session = sessions.value.find((item) => item.id === sessionId);
    if (!session) return;
    session.messages = [];
    await loadSessionMessages(sessionId, true);
  }

  return {
    sessions,
    activeSessionId,
    activeSession,
    createSession,
    syncSessionsFromBackend,
    loadSessionMessages,
    reloadSessionMessages,
    sendMessage,
    handleChannelResponse,
    handleStreamEvent,
  };
}
