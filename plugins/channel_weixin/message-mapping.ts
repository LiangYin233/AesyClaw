import { basename } from 'node:path';
import type { AdapterInboundDraft, ResourceHandle } from '../../src/channels/core/types.ts';

export interface WeixinMessageItem {
  type?: number;
  text_item?: {
    text?: string;
  };
  image_item?: Record<string, unknown>;
  voice_item?: Record<string, unknown>;
  file_item?: {
    file_name?: string;
  };
  video_item?: Record<string, unknown>;
  ref_msg?: unknown;
}

export interface WeixinInboundMessage {
  message_id?: string | number;
  from_user_id?: string;
  create_time_ms?: number;
  context_token?: string;
  item_list?: WeixinMessageItem[];
}

export async function mapInboundWeixinMessage(
  message: WeixinInboundMessage,
  deps: {
    channelName?: string;
    resolveMediaItem: (item: WeixinMessageItem, index: number) => Promise<ResourceHandle | null>;
    persistContextToken?: (peerId: string, token: string) => Promise<void>;
  }
): Promise<AdapterInboundDraft | null> {
  const peerId = message.from_user_id?.trim();
  if (!peerId) {
    return null;
  }

  if (message.context_token?.trim()) {
    await deps.persistContextToken?.(peerId, message.context_token.trim());
  }

  const segments: AdapterInboundDraft['segments'] = [];
  const references: unknown[] = [];

  for (const [index, item] of (message.item_list || []).entries()) {
    if (item.ref_msg) {
      references.push(item.ref_msg);
    }

    if (item.type === 1 && item.text_item?.text) {
      segments.push({
        type: 'text',
        text: item.text_item.text
      });
      continue;
    }

    if (item.type === 2 || item.type === 3 || item.type === 4 || item.type === 5) {
      const resource = await deps.resolveMediaItem(item, index);
      if (!resource) {
        continue;
      }

      if (item.type === 2) {
        segments.push({ type: 'image', resource });
      } else if (item.type === 3) {
        segments.push({ type: 'audio', resource });
      } else if (item.type === 4) {
        segments.push({ type: 'file', resource });
      } else {
        segments.push({ type: 'video', resource });
      }
    }
  }

  if (segments.length === 0) {
    return null;
  }

  return {
    conversation: {
      id: peerId,
      type: 'private'
    },
    sender: {
      id: peerId
    },
    timestamp: typeof message.create_time_ms === 'number' ? new Date(message.create_time_ms) : new Date(),
    platformMessageId: message.message_id !== undefined ? String(message.message_id) : undefined,
    segments,
    metadata: {
      contextToken: message.context_token,
      references: references.length > 0 ? references : undefined,
      source: 'weixin'
    },
    rawEvent: message
  };
}

export function fallbackResourceName(item: WeixinMessageItem, index: number, kind: ResourceHandle['kind']): string {
  if (kind === 'file' && item.file_item?.file_name) {
    return item.file_item.file_name;
  }

  return `${kind}-${index}-${basename(item.file_item?.file_name || '') || 'resource'}`.replace(/-resource$/, '');
}
