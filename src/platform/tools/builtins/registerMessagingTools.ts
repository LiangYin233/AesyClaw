import type { SessionManager } from '../../../features/sessions/index.js';
import type { OutboundMessage } from '../../../types.js';
import type { PluginManager } from '../../../plugins/index.js';
import type { ToolContext, ToolRegistry } from '../ToolRegistry.js';
import { normalizeToolError } from '../errors.js';
import {
  type BuiltInLogger,
  formatToolError,
  requireSessionContext,
  rethrowToolAbortError,
  throwIfToolAborted
} from './shared.js';

function buildHistoryEntry(content: string, media?: string[], files?: string[]): string {
  const trimmed = content.trim();
  const attachmentParts: string[] = [];

  if (media && media.length > 0) {
    attachmentParts.push(`${media.length} 张图片`);
  }

  if (files && files.length > 0) {
    attachmentParts.push(`${files.length} 个文件`);
  }

  if (attachmentParts.length === 0) {
    return trimmed;
  }

  const attachmentSummary = `发送了${attachmentParts.join('、')}`;
  return trimmed ? `${trimmed}\n\n[附件: ${attachmentSummary}]` : `[附件: ${attachmentSummary}]`;
}

export function registerMessagingTools(args: {
  toolRegistry: ToolRegistry;
  pluginManager: PluginManager;
  sessionManager: SessionManager;
  log: BuiltInLogger;
}): void {
  const { toolRegistry, pluginManager, sessionManager, log } = args;

  const publishOutboundMessage = async (message: OutboundMessage): Promise<void> => {
    await pluginManager.dispatchMessage(message);
  };

  toolRegistry.register({
    name: 'send_msg_to_user',
    description: '向当前会话发送文本、图片或文件。LLM 在 Agent 执行过程中也可以使用该工具向用户同步当前步骤、说明正在进行的操作或汇报阶段性进展。',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: '发送文本；可为空，但 content、media、files 至少要提供一个。'
        },
        media: {
          type: 'array',
          items: { type: 'string' },
          description: '图片路径数组。'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: '非图片文件路径数组。'
        }
      }
    },
    execute: async (params: Record<string, any>, context?: ToolContext) => {
      throwIfToolAborted(context?.signal);
      const content = String(params.content ?? '');
      const media = Array.isArray(params.media)
        ? params.media.filter((item): item is string => typeof item === 'string')
        : undefined;
      const files = Array.isArray(params.files)
        ? params.files.filter((item): item is string => typeof item === 'string')
        : undefined;

      if (content.trim().length === 0 && (!media || media.length === 0) && (!files || files.length === 0)) {
        return '错误：content、media、files 至少需要提供一个。';
      }

      if (!context?.chatId || !context?.channel) {
        log.error('send_msg_to_user 缺少会话上下文', {
          hasChannel: !!context?.channel,
          hasChatId: !!context?.chatId
        });
        return '错误：无法获取当前会话信息，此工具只能在用户会话中使用。';
      }

      const outboundMessage: OutboundMessage = {
        channel: context.channel,
        chatId: context.chatId,
        content,
        messageType: context.messageType || 'private',
        media: media && media.length > 0 ? media : undefined,
        files: files && files.length > 0 ? files : undefined
      };

      try {
        const { channel, chatId } = requireSessionContext(context);
        throwIfToolAborted(context?.signal);
        await publishOutboundMessage(outboundMessage);
        if (context.sessionKey) {
          const historyEntry = buildHistoryEntry(content, media, files);
          if (historyEntry) {
            throwIfToolAborted(context?.signal);
            await sessionManager.addMessage(context.sessionKey, 'assistant', historyEntry);
          }
        }
        const attachmentCount = (media?.length || 0) + (files?.length || 0);
        const attachmentInfo = attachmentCount > 0 ? ` (包含 ${attachmentCount} 个附件)` : '';
        log.debug('send_msg_to_user 执行完成', { channel, chatId, attachmentCount });
        return `消息已发送${attachmentInfo}`;
      } catch (error) {
        rethrowToolAbortError(error, context?.signal);
        log.error('send_msg_to_user 执行失败', {
          channel: context?.channel,
          chatId: context?.chatId,
          sessionKey: context?.sessionKey,
          mediaCount: media?.length || 0,
          fileCount: files?.length || 0,
          error: normalizeToolError(error)
        });
        return `发送失败：${formatToolError(error)}`;
      }
    }
  }, 'built-in');
}
