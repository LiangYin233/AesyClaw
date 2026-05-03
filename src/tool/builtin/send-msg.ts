/**
 * 内置 send_msg 工具。
 *
 * 通过管道的正常出站传递路径，向当前会话发送文本消息，
 * 可附带媒体附件。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import { errorMessage } from '../../core/utils';
import type { MediaAttachment, OutboundMessage, ToolOwner } from '../../core/types';

/** send_msg 的参数模式 */
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

/**
 * 创建 send_msg 工具定义。
 *
 * @returns send_msg 工具的 AesyClawTool 定义
 */
export function createSendMsgTool(): AesyClawTool {
  return {
    name: 'send_msg',
    description: '向当前会话发送文本消息，可附带媒体附件',
    parameters: SendMessageParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { text, media } = params as SendMessageParams;
      try {
        if (!context.sendMessage) {
          return {
            content: 'send_msg 在此上下文中不可用，因为没有可用的出站发送函数。',
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
            content: '消息在发送前被阻止。',
            isError: true,
          };
        }

        return {
          content: `消息已发送: "${text}"`,
        };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}
