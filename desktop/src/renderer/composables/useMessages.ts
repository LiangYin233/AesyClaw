/** useMessages composable — 消息状态管理。
 *
 * 负责消息的解析、流式处理、工具调用状态管理。
 */

import type { ChatMessageEvent, DesktopHistoryMessage } from '../../preload/index';
import type { ChatMessage, ChatSession, ToolCallState, ChatAttachment, MediaItem } from '../types/chat';
import { stripInformationTags } from '../utils/title';

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

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useMessages() {
  /** 处理流式事件 */
  function handleStreamEvent(
    event: ChatMessageEvent,
    session: ChatSession,
    onDeleteConfirmed?: (sessionId: string) => void,
  ): void {
    switch (event.type) {
      case 'chunk': {
        appendAssistantChunk(session, event.text);
        markDeleteConfirmedIfNeeded(session, event.text, onDeleteConfirmed);
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

  function markDeleteConfirmedIfNeeded(
    session: ChatSession,
    text: string,
    onDeleteConfirmed?: (sessionId: string) => void,
  ): void {
    if (text.includes('当前会话已删除') && onDeleteConfirmed) {
      onDeleteConfirmed(session.id);
    }
  }

  /** 从历史消息构建聊天消息列表 */
  function buildMessagesFromHistory(raw: DesktopHistoryMessage[]): ChatMessage[] {
    const converted: ChatMessage[] = [];
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
        const toolCalls = parseToolCallsFromMessage(message);
        
        if (toolCalls.length === 0) {
          converted.push({
            role: 'assistant',
            text: cleanText,
            streaming: false,
            usage: message.usage,
            media: attachmentsToMedia(attachments),
          });
          continue;
        }
        
        if (cleanText) {
          converted.push({
            role: 'assistant',
            text: cleanText,
            streaming: false,
            usage: message.usage,
          });
        }
        
        toolCalls.forEach((tc) => {
          const card: ChatMessage = { role: 'tool', toolCall: tc };
          converted.push(card);
          toolCallIndex.set(tc.toolCallId, tc);
        });
        continue;
      }

      if (message.role === 'toolResult') {
        const tc = parseToolResultFromMessage(message);
        const existing = toolCallIndex.get(tc.toolCallId);
        if (existing) {
          existing.result = tc.result;
          existing.isError = tc.isError;
          existing.status = tc.status;
        } else {
          converted.push({ role: 'tool', toolCall: tc });
        }
      }
    }

    return converted;
  }

  // ── 历史消息工具数据解析 ──────────────────────────────────

  /** 从历史 assistant 消息中读取工具调用（优先新 DTO，兼容旧 toolData） */
  function parseToolCallsFromMessage(message: DesktopHistoryMessage): ToolCallState[] {
    if (message.toolCalls && message.toolCalls.length > 0) {
      return message.toolCalls.map((tc) => ({
        toolCallId: tc.id,
        toolName: tc.name,
        args: tc.arguments ?? {},
        status: 'done' as const,
        expanded: false,
      }));
    }
    return parseToolCallsFromData(message.toolData);
  }

  /** 从 assistant 消息的 toolData 中解析 ToolCallState 列表（兼容旧格式） */
  function parseToolCallsFromData(toolData: string | undefined): ToolCallState[] {
    if (!toolData) return [];
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

  /** 从历史 toolResult 消息中读取工具结果（优先新 DTO，兼容旧 toolData） */
  function parseToolResultFromMessage(message: DesktopHistoryMessage): ToolCallState {
    if (message.toolResult) {
      return {
        toolCallId: message.toolResult.toolCallId,
        toolName: message.toolResult.toolName,
        args: {},
        result: message.content,
        isError: message.toolResult.isError,
        status: message.toolResult.isError ? 'error' : 'done',
        expanded: false,
      };
    }
    return parseToolResultFromData(message.toolData, message.content);
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

  return {
    handleStreamEvent,
    buildMessagesFromHistory,
    parseToolCallsFromMessage,
    parseToolResultFromMessage,
  };
}
