/**
 * 内置 send_msg 工具。
 *
 * 通过管道的正常出站传递路径，向当前会话发送文本消息，
 * 可附带媒体附件。
 */

import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import { errorMessage } from '@aesyclaw/core/utils';
import type {
  Message,
  ImageComponent,
  RecordComponent,
  VideoComponent,
  FileComponent,
  ToolOwner,
} from '@aesyclaw/core/types';

const MEDIA_TYPE_MAP = {
  image: 'Image',
  audio: 'Record',
  video: 'Video',
  file: 'File',
} as const;

type MediaParam = {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  path?: string;
  base64?: string;
  mimeType?: string;
};

type MediaComponent = ImageComponent | RecordComponent | VideoComponent | FileComponent;

const SEND_MSG_SCHEMA = Type.Object({
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

function toMediaComponent(media: MediaParam[]): MediaComponent[] {
  if (media.length === 0) {
    return [];
  }

  return media.map((item) => {
    const componentType = MEDIA_TYPE_MAP[item.type];
    return {
      type: componentType,
      ...(item.url ? { url: item.url } : {}),
      ...(item.path ? { path: item.path } : {}),
      ...(item.base64 ? { base64: item.base64 } : {}),
      ...(item.mimeType ? { mimeType: item.mimeType } : {}),
    } as MediaComponent;
  });
}

/**
 * 创建 send_msg 工具定义。
 *
 * @returns send_msg 工具的 AesyClawTool 定义
 */
export function createSendMsgTool(): AesyClawTool {
  return {
    name: 'send_msg',
    description: '向当前会话发送文本消息，可附带媒体附件',
    parameters: SEND_MSG_SCHEMA,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      const { text, media } = params as { text: string; media?: MediaParam[] };
      try {
        if (!context.sendMessage) {
          return {
            content: 'send_msg 在此上下文中不可用，因为没有可用的出站发送函数。',
            isError: true,
          };
        }

        const outbound: Message = {
          components: [{ type: 'Plain', text }, ...toMediaComponent(media ?? [])],
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
          details: { persistAsAssistantText: text },
        };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}
