import { errorMessage, getMessageText, isRecord } from '@aesyclaw/sdk';
import type { Message, MessageComponent, SenderInfo, SessionKey } from '@aesyclaw/sdk';
import { downloadInboundAttachment } from './attachments';
import type { OneBotApiResponse } from './websocket-client';
import {
  buildSenderInfo,
  componentTypeFromAttachment,
  isMediaComponent,
  mapAttachmentTypeFromSegment,
  optionalStringField,
  stringifyId,
  numericOrStringId,
} from './utils';
import type { MediaComponent, OneBotDownloadResult, OneBotInboundAttachmentSegment } from './types';

/**
 * 将 OneBot 事件映射为内部 Message 格式。
 * 仅处理 post_type === 'message' 且 message_type 为 private 或 group 的事件。
 *
 * @param event - OneBot 原始事件数据
 * @param channelName - 渠道名称，默认 'onebot'
 * @returns 解析后的消息、会话键和发送者信息，不匹配时返回 null
 */
export function mapOneBotEventToMessage(
  event: unknown,
  channelName = 'onebot',
): { message: Message; sessionKey: SessionKey; sender?: SenderInfo } | null {
  if (!isRecord(event) || event['post_type'] !== 'message') {
    return null;
  }

  const messageType = event['message_type'];
  if (messageType !== 'private' && messageType !== 'group') {
    return null;
  }

  const senderId = stringifyId(event['user_id']);
  if (!senderId) {
    return null;
  }

  const chatId = messageType === 'group' ? stringifyId(event['group_id']) : senderId;
  if (!chatId) {
    return null;
  }

  return {
    message: {
      components: extractOneBotComponents(event['message']),
    },
    sessionKey: {
      channel: channelName,
      type: messageType,
      chatId,
    },
    sender: buildSenderInfo(senderId, event['sender']),
  };
}

/**
 * 下载消息中的附件（图片、音频、视频、文件）到本地。
 *
 * @param inbound - 入站消息
 * @param event - OneBot 原始事件
 * @param sendStreamAction - 流式 API 请求回调
 * @param mediaDir - 媒体文件存储目录
 * @returns 追加了下载结果标注的消息
 */
export async function enrichMessageWithDownloads(
  inbound: Message,
  event: Record<string, unknown>,
  sendStreamAction: (
    action: string,
    params: Record<string, unknown>,
  ) => Promise<OneBotApiResponse[]>,
  mediaDir: string,
): Promise<Message> {
  const segments = extractOneBotInboundAttachmentSegments(event['message']);
  if (segments.length === 0) {
    return inbound;
  }

  const components = inbound.components.map((component) => ({ ...component }));
  const attachmentLines: string[] = [];
  const downloadFailures: string[] = [];

  for (const segment of segments) {
    const componentIndex = findDownloadComponentIndex(components, segment);
    const fallbackComponent = mapOneBotAttachmentComponent(segment);
    try {
      const downloaded = await downloadInboundAttachment(segment, sendStreamAction, mediaDir);
      if (componentIndex >= 0) {
        components[componentIndex] = mergeDownloadedComponent(
          components[componentIndex],
          downloaded,
        );
      }
      attachmentLines.push(`- ${downloaded.type}: ${downloaded.path}`);
    } catch (err) {
      if (componentIndex >= 0 && fallbackComponent) {
        components[componentIndex] = { ...fallbackComponent, ...components[componentIndex] };
      }
      downloadFailures.push(`- ${segment.attachmentType}: ${errorMessage(err)}`);
    }
  }

  if (attachmentLines.length === 0 && downloadFailures.length === 0) {
    return inbound;
  }

  const sections: string[] = [];
  if (attachmentLines.length > 0) {
    sections.push('[Attachments]');
    sections.push(...attachmentLines);
  }
  if (downloadFailures.length > 0) {
    sections.push('[Attachment download errors]');
    sections.push(...downloadFailures);
  }

  const content = getMessageText(inbound);
  const annotationText = content.length > 0 ? `\n\n${sections.join('\n')}` : sections.join('\n');
  return {
    ...inbound,
    components: [...components, { type: 'Plain', text: annotationText }],
  };
}

/**
 * 通过 API 获取 Reply 组件的引用消息内容，填充组件详情。
 *
 * @param inbound - 入站消息
 * @param sendAction - API 请求回调
 * @returns 填充了回复内容的消息
 */
export async function enrichMessageWithReplyContent(
  inbound: Message,
  sendAction: (action: string, params: Record<string, unknown>) => Promise<OneBotApiResponse>,
): Promise<Message> {
  const replyIndices: number[] = [];
  for (let i = 0; i < inbound.components.length; i++) {
    const component = inbound.components[i];
    if (component === undefined) {
      continue;
    }
    if (component.type === 'Reply') {
      const reply = component as Extract<MessageComponent, { type: 'Reply' }>;
      if (reply.components.length === 0 && reply.id) {
        replyIndices.push(i);
      }
    }
  }

  if (replyIndices.length === 0) {
    return inbound;
  }

  const components = inbound.components.map((component) => ({ ...component }));

  for (const index of replyIndices) {
    const replyComponent = components[index] as Extract<MessageComponent, { type: 'Reply' }>;
    try {
      const msgId = replyComponent.id;
      if (!msgId) {
        continue;
      }
      const response = await sendAction('get_msg', { message_id: numericOrStringId(msgId) });
      if (response.status !== 'ok' || !isRecord(response.data)) {
        continue;
      }

      const msgData = response.data;
      const replyComponents = extractOneBotComponents(msgData['message']);
      const replySenderId = stringifyId(msgData['user_id']);
      const replySender = replySenderId
        ? buildSenderInfo(replySenderId, msgData['sender'])
        : undefined;

      components[index] = {
        ...replyComponent,
        components: replyComponents,
        ...(replySender ? { sender: replySender } : {}),
      };
    } catch {
      // 获取回复消息失败时保留空组件作为降级结果。
    }
  }

  return { ...inbound, components };
}

/**
 * 在消息成分列表中查找与给定附件分段匹配的媒体组件的索引。
 *
 * @param components - 消息成分列表
 * @param segment - OneBot 附件分段
 * @returns 匹配的组件索引，未找到返回 -1
 */
export function findDownloadComponentIndex(
  components: MessageComponent[],
  segment: OneBotInboundAttachmentSegment,
): number {
  return components.findIndex(
    (component) =>
      component.type === segment.componentType &&
      isMediaComponent(component) &&
      component.file ===
        (typeof segment.data['file'] === 'string' ? segment.data['file'] : undefined) &&
      component.url === (typeof segment.data['url'] === 'string' ? segment.data['url'] : undefined),
  );
}

/**
 * 将下载结果合并到对应的消息组件中。
 *
 * @param component - 原始消息组件
 * @param downloaded - 下载结果
 * @returns 合并了路径和 URL 的组件
 */
export function mergeDownloadedComponent(
  component: MessageComponent | undefined,
  downloaded: OneBotDownloadResult,
): MessageComponent {
  const type = componentTypeFromAttachment(downloaded.type);
  const base = component?.type === type ? component : ({ type } as MessageComponent);
  return {
    ...base,
    ...(downloaded.url ? { url: downloaded.url } : {}),
    ...(downloaded.path ? { path: downloaded.path } : {}),
  };
}

/**
 * 从 OneBot 消息数组中提取消息成分列表。
 *
 * @param message - OneBot message 字段，可以是字符串或分段数组
 * @returns 消息成分数组
 */
export function extractOneBotComponents(message: unknown): MessageComponent[] {
  if (typeof message === 'string') {
    return [{ type: 'Plain', text: message }];
  }

  if (!Array.isArray(message)) {
    return [];
  }

  return message.map((segment) => mapOneBotSegmentToComponent(segment));
}

/**
 * 从 OneBot 消息中提取需要下载的附件分段信息。
 *
 * @param message - OneBot message 数组
 * @returns 需下载的附件分段列表
 */
export function extractOneBotInboundAttachmentSegments(
  message: unknown,
): OneBotInboundAttachmentSegment[] {
  if (!Array.isArray(message)) {
    return [];
  }

  return message
    .filter(
      (
        segment,
      ): segment is Record<string, unknown> & { type: string; data: Record<string, unknown> } =>
        isRecord(segment) && isRecord(segment['data']) && typeof segment['type'] === 'string',
    )
    .map((segment) => {
      const attachmentType = mapAttachmentTypeFromSegment(segment.type);
      if (!attachmentType) {
        return null;
      }

      return {
        attachmentType,
        componentType: componentTypeFromAttachment(attachmentType),
        segmentType: segment.type,
        data: segment.data,
      };
    })
    .filter((segment): segment is OneBotInboundAttachmentSegment => segment !== null);
}

/**
 * 将 OneBot 分段或附件分段映射为消息组件（不依赖事件上下文）。
 *
 * @param segment - OneBot 分段或带 segmentType 的附件对象
 * @returns 映射后的消息组件，无法映射时返回 null
 */
export function mapOneBotAttachmentComponent(segment: unknown): MessageComponent | null {
  if (!isRecord(segment) || !isRecord(segment['data'])) {
    return null;
  }

  const segmentType =
    typeof segment['type'] === 'string'
      ? segment['type']
      : typeof segment['segmentType'] === 'string'
        ? segment['segmentType']
        : null;
  if (!segmentType) {
    return null;
  }

  const attachmentType = mapAttachmentTypeFromSegment(segmentType);
  if (!attachmentType) {
    return null;
  }

  return mapMediaSegmentToComponent(componentTypeFromAttachment(attachmentType), segment['data']);
}

/**
 * 将单个 OneBot 消息分段转换为内部消息组件。
 *
 * @param segment - OneBot 分段对象
 * @returns 消息组件
 */
export function mapOneBotSegmentToComponent(segment: unknown): MessageComponent {
  if (!isRecord(segment) || typeof segment['type'] !== 'string') {
    return { type: 'Unknown' };
  }

  const data = isRecord(segment['data']) ? segment['data'] : {};
  const attachmentType = mapAttachmentTypeFromSegment(segment['type']);
  if (attachmentType && attachmentType !== 'file') {
    return mapMediaSegmentToComponent(componentTypeFromAttachment(attachmentType), data);
  }

  switch (segment['type']) {
    case 'text':
      return { type: 'Plain', text: typeof data['text'] === 'string' ? data['text'] : '' };
    case 'file':
      return mapFileSegmentToComponent(data);
    case 'face':
    case 'at':
    case 'forward':
    case 'node':
    case 'nodes':
      return { type: 'Unknown', segmentType: segment['type'], data };
    case 'reply':
      return {
        type: 'Reply',
        components: [],
        ...optionalStringField('id', stringifyId(data['id'])),
      };
    default:
      return { type: 'Unknown', segmentType: segment['type'], data };
  }
}

/**
 * 将媒体分段的数据映射为 Image/Record/Video/File 类型的消息组件。
 *
 * @param type - 组件类型
 * @param data - 分段数据
 * @returns 媒体组件
 */
export function mapMediaSegmentToComponent(
  type: Extract<MessageComponent['type'], 'Image' | 'Record' | 'Video' | 'File'>,
  data: Record<string, unknown>,
): MessageComponent {
  const url = typeof data['url'] === 'string' ? data['url'] : undefined;
  const pathValue = typeof data['path'] === 'string' ? data['path'] : undefined;
  const file = typeof data['file'] === 'string' ? data['file'] : undefined;
  const fields = {
    ...(url ? { url } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(file ? { file } : {}),
  };

  return { type, ...fields } as MediaComponent;
}

/**
 * 将文件分段的数据映射为 File 类型的消息组件（含 file_id、name 等扩展字段）。
 *
 * @param data - 文件分段数据
 * @returns File 组件
 */
export function mapFileSegmentToComponent(data: Record<string, unknown>): MessageComponent {
  const url = typeof data['url'] === 'string' ? data['url'] : undefined;
  const pathValue = typeof data['path'] === 'string' ? data['path'] : undefined;
  const file = typeof data['file'] === 'string' ? data['file'] : undefined;
  const fileId = typeof data['file_id'] === 'string' ? data['file_id'] : undefined;
  const name = typeof data['name'] === 'string' ? data['name'] : undefined;
  return {
    type: 'File',
    ...(url ? { url } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(file ? { file } : {}),
    ...(fileId ? { fileId } : {}),
    ...(name ? { name } : {}),
  };
}
