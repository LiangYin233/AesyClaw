/**
 * Built-in send_msg tool.
 *
 * Sends a text message to the current session, optionally with
 * media attachments, via the pipeline's normal outbound delivery path.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { MediaAttachment, OutboundMessage, ToolOwner } from '../../core/types';

/** Parameter schema for send_msg */
const SendMessageParamsSchema = Type.Object({
  text: Type.String({ description: '要发送的文本内容' }),
  media: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Union([
          Type.Literal('image'),
          Type.Literal('audio'),
          Type.Literal('video'),
          Type.Literal('file'),
        ]),
        url: Type.Optional(Type.String()),
        path: Type.Optional(Type.String()),
        base64: Type.Optional(Type.String()),
        mimeType: Type.Optional(Type.String()),
      }),
      { description: '媒体附件列表' },
    ),
  ),
});

type SendMessageParams = Static<typeof SendMessageParamsSchema>;

export function createSendMsgTool(): AesyClawTool {
  return {
    name: 'send_msg',
    description: '向当前会话发送文本消息，可附带媒体附件',
    parameters: SendMessageParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { text, media } = params as SendMessageParams;
      try {
        if (!context.sendMessage) {
          return {
            content: 'send_msg is unavailable in this context because no outbound send function is available.',
            isError: true,
          };
        }

        const outbound: OutboundMessage = {
          content: text,
          ...(media && media.length > 0 ? { attachments: media as MediaAttachment[] } : {}),
        };
        const delivered = await context.sendMessage(outbound);

        if (!delivered) {
          return {
            content: 'Message was blocked before delivery.',
            isError: true,
          };
        }

        return {
          content: `Message sent: "${text}"`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: message, isError: true };
      }
    },
  };
}
