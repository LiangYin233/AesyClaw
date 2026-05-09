import type { MessageComponent, SenderInfo } from '@aesyclaw/sdk';
import { isRecord } from '@aesyclaw/sdk';
import { ATTACHMENT_KIND, ATTACHMENT_TYPE_BY_SEGMENT, DEFAULT_CONFIG } from './constants';
import type { MediaComponent, OneBotAttachmentType, OneBotChannelConfig, OneBotInboundAttachmentSegment } from './types';

export function parseConfig(config: Record<string, unknown>): OneBotChannelConfig {
  return {
    serverUrl: readString(config['serverUrl'], DEFAULT_CONFIG.serverUrl),
    accessToken: readString(config['accessToken'], DEFAULT_CONFIG.accessToken),
  };
}

export function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

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

export function stringifyId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return null;
}

export function numericOrStringId(value: string): string | number {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && String(numeric) === value ? numeric : value;
}

export function optionalStringField(key: string, value: string | null): Record<string, string> {
  return value ? { [key]: value } : {};
}

export function isMediaComponent(component: MessageComponent): component is MediaComponent {
  return ['Image', 'Record', 'Video', 'File'].includes(component.type);
}

export function mapAttachmentTypeFromSegment(type: string): OneBotAttachmentType | null {
  return ATTACHMENT_TYPE_BY_SEGMENT[type] ?? null;
}

export function componentTypeFromAttachment(
  attachmentType: OneBotAttachmentType,
): OneBotInboundAttachmentSegment['componentType'] {
  return ATTACHMENT_KIND[attachmentType].componentType;
}
