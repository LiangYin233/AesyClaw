/**
 * Built-in send_msg tool.
 *
 * Sends a text message to the current session, optionally with
 * media attachments. For now returns a formatted message string
 * since actual channel sending depends on Pipeline.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

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

/** Dependencies needed by send_msg tool (typed as unknown until Pipeline is implemented) */
export interface SendMsgDeps {
  /** Will be Pipeline when implemented */
  pipeline: unknown;
}

export function createSendMsgTool(deps: SendMsgDeps): AesyClawTool {
  return {
    name: 'send_msg',
    description: '向当前会话发送文本消息，可附带媒体附件',
    parameters: SendMessageParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { text, media } = params as SendMessageParams;
      try {
        const hasMedia = media && media.length > 0;
        const mediaCount = hasMedia ? media!.length : 0;

        // TODO: When Pipeline is implemented, actually send the message
        // through the channel.

        if (hasMedia) {
          return {
            content: `Message sent: "${text}" (with ${mediaCount} media attachment(s))`,
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