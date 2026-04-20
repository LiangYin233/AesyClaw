import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import OpenAI from 'openai';
import {
  Tool,
  ToolDefinition,
  ToolExecuteContext,
  ToolExecutionResult,
  zodToToolParameters,
} from './types.js';
import { logger } from '../observability/logger.js';
import { toErrorMessage } from '../utils/errors.js';

interface ProviderRuntimeConfig {
  api_key?: string;
  base_url?: string;
}

export interface MultimodalRuntimeConfig {
  providers: Record<string, ProviderRuntimeConfig | undefined>;
  multimodal: {
    stt_provider: string;
    stt_model: string;
    vision_provider: string;
    vision_model: string;
  };
}

type MultimodalConfigResolver = () => MultimodalRuntimeConfig;

const AUDIO_MIME_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

const IMAGE_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function isRemoteMediaPath(mediaPath: string): boolean {
  return mediaPath.startsWith('http://') || mediaPath.startsWith('https://');
}

function getAudioMimeType(ext: string): string {
  return AUDIO_MIME_TYPES[ext] || 'audio/mpeg';
}

function getImageMimeType(ext: string): string {
  return IMAGE_MIME_TYPES[ext.toLowerCase()] || 'image/jpeg';
}

async function readImageAsDataUrl(imagePath: string): Promise<string> {
  const { readFile } = await import('fs/promises');
  const data = await readFile(imagePath);
  const base64 = data.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mimeType = getImageMimeType(ext);
  return `data:${mimeType};base64,${base64}`;
}

function createOpenAIClient(provider: ProviderRuntimeConfig): OpenAI {
  return new OpenAI({
    apiKey: provider.api_key,
    baseURL: provider.base_url,
  });
}

function buildMissingProviderResult(providerType: string, providerName: string): ToolExecutionResult {
  return {
    success: false,
    content: '',
    error: `未找到 ${providerType} provider: ${providerName}`,
  };
}

function buildToolDefinition(
  name: string,
  description: string,
  parametersSchema: z.ZodTypeAny
): ToolDefinition {
  return {
    name,
    description,
    parameters: zodToToolParameters(parametersSchema),
  };
}

function buildValidationErrorResult(message: string): ToolExecutionResult {
  return {
    success: false,
    content: '',
    error: message,
  };
}

function validateToolArgs<T>(
  parametersSchema: z.ZodType<T>,
  args: unknown
): { success: true; data: T } | { success: false; result: ToolExecutionResult } {
  const parsed = parametersSchema.safeParse(args);
  if (!parsed.success) {
    return {
      success: false,
      result: buildValidationErrorResult(`参数验证失败: ${parsed.error.message}`),
    };
  }

  return {
    success: true,
    data: parsed.data,
  };
}

const SpeechToTextSchema = z.object({
  audio_path: z.string().describe('语音文件路径，支持本地路径或URL'),
});

const ImageUnderstandingSchema = z.object({
  image_path: z.string().describe('图片文件路径，支持本地路径或URL'),
  prompt: z.string().describe('关于想要了解图片的方面的描述，例如"详细描述图片内容"或"这张图片有什么特别之处"'),
});

const SendMsgSchema = z.object({
  text: z.string().optional().describe('要额外发送的文字内容，可为空'),
  media_files: z.array(
    z.object({
      type: z.enum(['image', 'video', 'audio', 'file']).describe('媒体类型'),
      url: z.string().min(1).describe('媒体文件路径或URL'),
      filename: z.string().optional().describe('可选的文件名，仅用于描述'),
    })
  ).optional().describe('要额外发送的媒体文件列表'),
}).refine(
  value => Boolean(value.text?.trim()) || Boolean(value.media_files?.length),
  'text 和 media_files 至少需要提供一项'
);

export class SpeechToTextTool implements Tool {
  constructor(private readonly getConfig: MultimodalConfigResolver) {}

  readonly name = 'speech_to_text';
  readonly description = '【重要】将语音文件转换为文字。当用户发送语音消息时使用此工具。参数：audio_path（必填，语音文件的绝对路径或URL）。注意：此工具每个语音只能调用一次。返回转录后的文本内容。示例：audio_path="G:\\Project\\.aesyclaw\\media\\audio_xxx.mp3"';
  readonly parametersSchema = SpeechToTextSchema;

  getDefinition(): ToolDefinition {
    return buildToolDefinition(this.name, this.description, this.parametersSchema);
  }

  private resolveProvider(config: MultimodalRuntimeConfig): ProviderRuntimeConfig | ToolExecutionResult {
    const providerName = config.multimodal.stt_provider;
    const provider = config.providers[providerName];

    if (!provider) {
      return buildMissingProviderResult('STT', providerName);
    }

    return provider;
  }

  private async resolveAudioInput(
    audioPath: string
  ): Promise<{ fileBuffer: ArrayBuffer; mimeType: string; fileName: string } | ToolExecutionResult> {
    if (isRemoteMediaPath(audioPath)) {
      const response = await fetch(audioPath);
      if (!response.ok) {
        return {
          success: false,
          content: '',
          error: `下载音频文件失败: HTTP ${response.status}`,
        };
      }

      return {
        fileBuffer: await response.arrayBuffer(),
        mimeType: response.headers.get('content-type') || 'audio/mpeg',
        fileName: path.basename(audioPath),
      };
    }

    if (!fs.existsSync(audioPath)) {
      return {
        success: false,
        content: '',
        error: `音频文件不存在: ${audioPath}`,
      };
    }

    const buffer = fs.readFileSync(audioPath);
    return {
      fileBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      mimeType: getAudioMimeType(path.extname(audioPath).toLowerCase()),
      fileName: path.basename(audioPath),
    };
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = validateToolArgs(this.parametersSchema, args);
    if (!parsed.success) {
      return parsed.result;
    }

    const { audio_path } = parsed.data;

    logger.info({ audioPath: audio_path }, '开始语音转文字');

    try {
      const config = this.getConfig();
      const multimodalConfig = config.multimodal;

      const sttProvider = this.resolveProvider(config);
      if ('success' in sttProvider) {
        return sttProvider;
      }

      const client = createOpenAIClient(sttProvider);

      const audioInput = await this.resolveAudioInput(audio_path);
      if ('success' in audioInput) {
        return audioInput;
      }

      const transcription = await client.audio.transcriptions.create({
        file: new File([audioInput.fileBuffer], audioInput.fileName, { type: audioInput.mimeType }),
        model: multimodalConfig.stt_model,
      });

      logger.info({ audioPath: audio_path, textLength: transcription.text.length }, '语音转文字完成');

      return {
        success: true,
        content: transcription.text,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ error: errorMessage, audioPath: audio_path }, '语音转文字失败');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }

}

export class ImageUnderstandingTool implements Tool {
  constructor(private readonly getConfig: MultimodalConfigResolver) {}

  readonly name = 'image_understanding';
  readonly description = '【重要】理解图片内容。当用户发送图片时使用此工具。参数：image_path（必填，图片的绝对路径或URL），prompt（必填，你想了解图片的什么问题）。注意：此工具每个图片只能调用一次，多次调用同一图片会浪费资源。调用后返回图片理解结果。示例：image_path="G:\\Project\\.aesyclaw\\media\\image_xxx.jpg"，prompt="详细描述这张图片的内容"';
  readonly parametersSchema = ImageUnderstandingSchema;

  getDefinition(): ToolDefinition {
    return buildToolDefinition(this.name, this.description, this.parametersSchema);
  }

  private resolveProvider(config: MultimodalRuntimeConfig): ProviderRuntimeConfig | ToolExecutionResult {
    const providerName = config.multimodal.vision_provider;
    const provider = config.providers[providerName];

    if (!provider) {
      return buildMissingProviderResult('vision', providerName);
    }

    return provider;
  }

  private async resolveImageUrl(imagePath: string): Promise<{ imageUrl: string } | ToolExecutionResult> {
    if (isRemoteMediaPath(imagePath)) {
      return { imageUrl: imagePath };
    }

    if (!fs.existsSync(imagePath)) {
      return {
        success: false,
        content: '',
        error: `图片文件不存在: ${imagePath}`,
      };
    }

    return {
      imageUrl: await readImageAsDataUrl(imagePath),
    };
  }

  private resolvePrompt(prompt: string): string {
    const defaultPrompt = '请详细描述这张图片的内容，包括场景、人物、物品、颜色等细节。';
    return prompt || defaultPrompt;
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = validateToolArgs(this.parametersSchema, args);
    if (!parsed.success) {
      return parsed.result;
    }

    const { image_path, prompt } = parsed.data;

    logger.info({ imagePath: image_path, prompt }, '开始图片理解');

    try {
      const config = this.getConfig();
      const multimodalConfig = config.multimodal;

      const visionProvider = this.resolveProvider(config);
      if ('success' in visionProvider) {
        return visionProvider;
      }

      const client = createOpenAIClient(visionProvider);

      const imageInput = await this.resolveImageUrl(image_path);
      if ('success' in imageInput) {
        return imageInput;
      }

      const userPrompt = this.resolvePrompt(prompt);

      const response = await client.chat.completions.create({
        model: multimodalConfig.vision_model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: userPrompt,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageInput.imageUrl,
                },
              },
            ],
          },
        ],
      });

      const result = response.choices[0]?.message?.content || '';

      logger.info({ imagePath: image_path, resultLength: result.length }, '图片理解完成');

      return {
        success: true,
        content: result,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ error: errorMessage, imagePath: image_path }, '图片理解失败');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }

}

export class SendMsgTool implements Tool {
  readonly name = 'sendMsg';
  readonly description = '立即额外发送一条消息到当前会话，可包含文字和媒体文件。适用于先发送补充说明、阶段性结果、图片、音频、视频或文件。注意：这会立刻发送，不会替代最终回复。';
  readonly parametersSchema = SendMsgSchema;

  getDefinition(): ToolDefinition {
    return buildToolDefinition(this.name, this.description, this.parametersSchema);
  }

  async execute(args: unknown, context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = validateToolArgs(this.parametersSchema, args);
    if (!parsed.success) {
      return parsed.result;
    }

    if (!context.send) {
      return buildValidationErrorResult('当前会话不支持主动发送消息');
    }

    const text = parsed.data.text?.trim() ?? '';
    const mediaFiles = parsed.data.media_files?.map(file => ({
      type: file.type,
      url: file.url,
      filename: file.filename,
    }));

    logger.info(
      {
        chatId: context.chatId,
        sendTextLength: text.length,
        mediaCount: mediaFiles?.length ?? 0,
      },
      '开始发送额外消息'
    );

    try {
      await context.send({
        text,
        mediaFiles,
      });

      return {
        success: true,
        content: `已发送额外消息（文字长度: ${text.length}, 媒体数量: ${mediaFiles?.length ?? 0}）`,
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error(
        { chatId: context.chatId, error: errorMessage },
        '发送额外消息失败'
      );
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }
}

export function createMultimodalTools(getConfig: MultimodalConfigResolver): {
  speechToTextTool: SpeechToTextTool;
  imageUnderstandingTool: ImageUnderstandingTool;
  sendMsgTool: SendMsgTool;
} {
  return {
    speechToTextTool: new SpeechToTextTool(getConfig),
    imageUnderstandingTool: new ImageUnderstandingTool(getConfig),
    sendMsgTool: new SendMsgTool(),
  };
}
