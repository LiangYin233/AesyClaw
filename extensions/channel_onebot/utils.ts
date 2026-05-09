import type { MessageComponent, SenderInfo } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';
import { ATTACHMENT_KIND, ATTACHMENT_TYPE_BY_SEGMENT, DEFAULT_CONFIG } from './constants';
import type { MediaComponent, OneBotAttachmentType, OneBotChannelConfig, OneBotInboundAttachmentSegment } from './types';

/**
 * 从原始配置中解析 OneBot 渠道配置。
 *
 * @param config - 原始配置对象
 * @returns 解析后的渠道配置
 */
export function parseConfig(config: Record<string, unknown>): OneBotChannelConfig {
  return {
    serverUrl: readString(config['serverUrl'], DEFAULT_CONFIG.serverUrl),
    accessToken: readString(config['accessToken'], DEFAULT_CONFIG.accessToken),
  };
}

/**
 * 安全读取字符串值，无效时返回回退值。
 *
 * @param value - 待读取的值
 * @param fallback - 回退值
 * @returns 有效字符串或回退值
 */
export function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * 从 OneBot sender 字段构建内部发送者信息。
 *
 * @param senderId - 发送者 ID
 * @param sender - OneBot sender 字段
 * @returns 发送者信息
 */
export function buildSenderInfo(senderId: string, sender: unknown): SenderInfo {
  if (!isRecord(sender)) {
    return { id: senderId };
  }

  const nickname = typeof sender['nickname'] === 'string' ? sender['nickname'] : undefined;
  const card =
    typeof sender['card'] === 'string' && sender['card'].length > 0 ? sender['card'] : undefined;
  const role = typeof sender['role'] === 'string' ? sender['role'] : undefined;
  return {
    id: senderId,
    ...((card ?? nickname) ? { name: card ?? nickname } : {}),
    ...(role ? { role } : {}),
  };
}

/**
 * 将数值或字符串 ID 转为字符串。
 *
 * @param value - ID 值
 * @returns 字符串 ID，无效时返回 null
 */
export function stringifyId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

/**
 * 将字符串 ID 转为数值（如果可以安全转换），否则保留原字符串。
 *
 * @param value - 字符串 ID
 * @returns 数值或字符串
 */
export function numericOrStringId(value: string): string | number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === value ? numeric : value;
}

/**
 * 构建可选字段，值为 null/空时返回空对象。
 *
 * @param key - 字段名
 * @param value - 字段值
 * @returns 包含该字段的对象或空对象
 */
export function optionalStringField(key: string, value: string | null): Record<string, string> {
  return value ? { [key]: value } : {};
}

/**
 * 判断消息组件是否为媒体类型（Image/Record/Video/File）。
 *
 * @param component - 消息组件
 * @returns 是否为媒体组件
 */
export function isMediaComponent(component: MessageComponent): component is MediaComponent {
  return ['Image', 'Record', 'Video', 'File'].includes(component.type);
}

/**
 * 根据 OneBot 分段类型查询对应的附件类型。
 *
 * @param type - OneBot 分段类型（image/record/video/file）
 * @returns 附件类型，不匹配时返回 null
 */
export function mapAttachmentTypeFromSegment(type: string): OneBotAttachmentType | null {
  return ATTACHMENT_TYPE_BY_SEGMENT[type] ?? null;
}

/**
 * 根据附件类型查询对应的消息组件类型。
 *
 * @param attachmentType - 附件类型
 * @returns 消息组件类型
 */
export function componentTypeFromAttachment(
  attachmentType: OneBotAttachmentType,
): OneBotInboundAttachmentSegment['componentType'] {
  return ATTACHMENT_KIND[attachmentType].componentType;
}
