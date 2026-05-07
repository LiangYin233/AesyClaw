import { getMessageText } from '@aesyclaw/sdk';
import type { Message, SessionKey } from '@aesyclaw/sdk';
import { uploadAttachmentStream, validateApiResponse } from './attachments';
import { OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE, SEGMENT_TYPE_BY_ATTACHMENT, SEND_ACTION_BY_CHAT_TYPE } from './constants';
import type { MediaComponent, OneBotLogger, OneBotMessageSegment, UploadedAttachment } from './types';
import { isMediaComponent, numericOrStringId } from './utils';
import type { OneBotActionTransport } from './websocket-client';

export async function sendOneBotMessage(
  sessionKey: SessionKey,
  message: Message,
  transport: OneBotActionTransport,
  logger?: OneBotLogger,
): Promise<void> {
  const summary = summarizeMessage(sessionKey, message);
  const { action, params } = await buildSendAction(sessionKey, message, transport, logger, summary);

  try {
    const response = await transport.sendAction(action, params);
    validateApiResponse(response);
  } catch (err) {
    logger?.error(
      'OneBot outbound message send failed',
      {
        ...summary,
        stage: 'message-send',
        action,
      },
      err,
    );
    throw err;
  }
}

export async function buildSendAction(
  sessionKey: SessionKey,
  message: Message,
  transport: OneBotActionTransport,
  logger: OneBotLogger | undefined,
  summary: ReturnType<typeof summarizeMessage>,
): Promise<{ action: string; params: Record<string, unknown> }> {
  const outboundMessage = await buildOneBotSegments(message, transport, logger, summary);
  const actionConfig = SEND_ACTION_BY_CHAT_TYPE[sessionKey.type];

  if (actionConfig) {
    return {
      action: actionConfig.action,
      params: {
        [actionConfig.idParam]: numericOrStringId(sessionKey.chatId),
        message: outboundMessage,
      },
    };
  }

  throw new Error(`OneBot channel cannot send to chat type "${sessionKey.type}"`);
}

export async function buildOneBotSegments(
  message: Message,
  transport: OneBotActionTransport,
  logger: OneBotLogger | undefined,
  summary: ReturnType<typeof summarizeMessage>,
): Promise<string | OneBotMessageSegment[]> {
  const mediaComponents = message.components.filter(isMediaComponent);

  if (mediaComponents.length === 0) {
    return getMessageText(message);
  }

  const segments: OneBotMessageSegment[] = [];
  const text = getMessageText(message);
  if (text.length > 0) {
    segments.push({ type: 'text', data: { text } });
  }

  for (const [attachmentIndex, component] of mediaComponents.entries()) {
    let uploaded: UploadedAttachment | undefined;
    try {
      uploaded = await uploadAttachmentStream(component, transport);
    } catch (err) {
      logger?.error(
        'OneBot outbound attachment upload failed',
        {
          ...summary,
          stage: 'attachment-upload',
          attachmentIndex,
          attachmentType: component.type,
          attachmentSource: summarizeAttachmentSource(component),
        },
        err,
      );
      throw err;
    }

    segments.push({
      type: SEGMENT_TYPE_BY_ATTACHMENT[OUTBOUND_COMPONENT_TO_ATTACHMENT_TYPE[component.type]],
      data: {
        file: uploaded.filePath,
        file_path: uploaded.filePath,
        name: uploaded.fileName,
      },
    });
  }

  if (segments.length === 0) {
    throw new Error('OneBot outbound message has no components to send');
  }

  return segments;
}

export function summarizeMessage(
  sessionKey: SessionKey,
  message: Message,
): {
  sessionChannel: string;
  chatType: string;
  contentLength: number;
  attachmentCount: number;
  attachmentTypes: string[];
} {
  const text = getMessageText(message);
  const mediaComponents = message.components.filter(isMediaComponent);
  return {
    sessionChannel: sessionKey.channel,
    chatType: sessionKey.type,
    contentLength: text.length,
    attachmentCount: mediaComponents.length,
    attachmentTypes: mediaComponents.map((component) => component.type),
  };
}

export function summarizeAttachmentSource(component: MediaComponent): string {
  if (component.base64) {
    return 'base64';
  }
  if (component.path) {
    return 'path';
  }
  if (component.url) {
    return 'url';
  }
  return 'missing';
}
