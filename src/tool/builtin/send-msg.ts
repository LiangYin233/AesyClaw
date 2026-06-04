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
import { errorMessage } from '@aesyclaw/core/errors';
import type { Message, MediaComponent, ToolOwner } from '@aesyclaw/core/types';

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
  name?: string;
};

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

const MEDIA_KIND_NAMES: Record<string, string> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
  file: 'file',
};

function buildAttachmentText(media: MediaParam[]): string | undefined {
  const first = media[0];
  if (!first) return undefined;
  const kind = MEDIA_KIND_NAMES[first.type] as string;
  const path = first.path ?? first.url ?? 'inline';
  const name = first.name ?? path.split(/[/\\]+/).pop() ?? 'attachment';
  const mime = first.mimeType ?? guessMime(name);
  return `[Attachments]\n- ${kind}: ${path} (${name}, ${mime})`;
}

function guessMime(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
    md: 'text/markdown',
  };
  const mime = (ext ? map[ext] : undefined) as string | undefined;
  return mime ?? 'application/octet-stream';
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
        const attachmentText = buildAttachmentText(media ?? []);
        const persistText = attachmentText ? text + '\n\n' + attachmentText : text;

        return {
          content: `消息已发送: "${text}"`,
          details: { persistAsAssistantText: persistText },
        };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}
