import { randomUUID } from 'crypto';
import type { AdapterInboundDraft, ChannelMessage } from './types.js';

function normalizeTimestamp(timestamp?: Date): Date {
  return timestamp instanceof Date ? timestamp : new Date();
}

export function mapDraftToChannelMessage(
  channelName: string,
  draft: AdapterInboundDraft,
  direction: ChannelMessage['direction']
): ChannelMessage {
  return {
    id: draft.platformMessageId || randomUUID(),
    channel: channelName,
    direction,
    conversation: draft.conversation,
    sender: draft.sender,
    timestamp: normalizeTimestamp(draft.timestamp),
    platformMessageId: draft.platformMessageId,
    segments: draft.segments,
    metadata: draft.metadata,
    rawEvent: draft.rawEvent
  };
}
