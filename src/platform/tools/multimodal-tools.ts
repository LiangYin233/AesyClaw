import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import OpenAI from 'openai';
import { ITool, ToolDefinition, ToolExecuteContext, ToolExecutionResult, zodToToolParameters } from './types.js';
import { logger } from '../observability/logger.js';

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

const SpeechToTextSchema = z.object({
  audio_path: z.string().describe('语音文件路径，支持本地路径或URL'),
});

const ImageUnderstandingSchema = z.object({
  image_path: z.string().describe('图片文件路径，支持本地路径或URL'),
  prompt: z.string().describe('关于想要了解图片的方面的描述，例如"详细描述图片内容"或"这张图片有什么特别之处"'),
});

export class SpeechToTextTool implements ITool {
  constructor(private readonly getConfig: MultimodalConfigResolver) {}

  readonly name = 'speech_to_text';
  readonly description = '【重要】将语音文件转换为文字。当用户发送语音消息时使用此工具。参数：audio_path（必填，语音文件的绝对路径或URL）。注意：此工具每个语音只能调用一次。返回转录后的文本内容。示例：audio_path="G:\\Project\\.aesyclaw\\media\\audio_xxx.mp3"';
  readonly parametersSchema = SpeechToTextSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = this.parametersSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        content: '',
        error: `参数验证失败: ${parsed.error.message}`,
      };
    }

    const { audio_path } = parsed.data;

    logger.info({ audioPath: audio_path, traceId: context.traceId }, '开始语音转文字');

    try {
      const config = this.getConfig();
      const multimodalConfig = config.multimodal;

      const sttProvider = config.providers[multimodalConfig.stt_provider];
      if (!sttProvider) {
        return {
          success: false,
          content: '',
          error: `未找到 STT provider: ${multimodalConfig.stt_provider}`,
        };
      }

      const client = new OpenAI({
        apiKey: sttProvider.api_key,
        baseURL: sttProvider.base_url,
      });

      let fileBuffer: ArrayBuffer;
      let mimeType: string;

      if (audio_path.startsWith('http://') || audio_path.startsWith('https://')) {
        const response = await fetch(audio_path);
        if (!response.ok) {
          return {
            success: false,
            content: '',
            error: `下载音频文件失败: HTTP ${response.status}`,
          };
        }
        fileBuffer = await response.arrayBuffer();
        mimeType = response.headers.get('content-type') || 'audio/mpeg';
      } else {
        if (!fs.existsSync(audio_path)) {
          return {
            success: false,
            content: '',
            error: `音频文件不存在: ${audio_path}`,
          };
        }
        const buffer = fs.readFileSync(audio_path);
        fileBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
        const ext = path.extname(audio_path).toLowerCase();
        mimeType = this.getMimeType(ext);
      }

      const fileName = path.basename(audio_path);

      const transcription = await client.audio.transcriptions.create({
        file: new File([fileBuffer], fileName, { type: mimeType }),
        model: multimodalConfig.stt_model,
      });

      logger.info({ audioPath: audio_path, textLength: transcription.text.length }, '语音转文字完成');

      return {
        success: true,
        content: transcription.text,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, audioPath: audio_path }, '语音转文字失败');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.mp4': 'audio/mp4',
      '.wav': 'audio/wav',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
    };
    return mimeTypes[ext] || 'audio/mpeg';
  }
}

export class ImageUnderstandingTool implements ITool {
  constructor(private readonly getConfig: MultimodalConfigResolver) {}

  readonly name = 'image_understanding';
  readonly description = '【重要】理解图片内容。当用户发送图片时使用此工具。参数：image_path（必填，图片的绝对路径或URL），prompt（必填，你想了解图片的什么问题）。注意：此工具每个图片只能调用一次，多次调用同一图片会浪费资源。调用后返回图片理解结果。示例：image_path="G:\\Project\\.aesyclaw\\media\\image_xxx.jpg"，prompt="详细描述这张图片的内容"';
  readonly parametersSchema = ImageUnderstandingSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = this.parametersSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        content: '',
        error: `参数验证失败: ${parsed.error.message}`,
      };
    }

    const { image_path, prompt } = parsed.data;

    logger.info({ imagePath: image_path, prompt, traceId: context.traceId }, '开始图片理解');

    try {
      const config = this.getConfig();
      const multimodalConfig = config.multimodal;

      const visionProvider = config.providers[multimodalConfig.vision_provider];
      if (!visionProvider) {
        return {
          success: false,
          content: '',
          error: `未找到 vision provider: ${multimodalConfig.vision_provider}`,
        };
      }

      const client = new OpenAI({
        apiKey: visionProvider.api_key,
        baseURL: visionProvider.base_url,
      });

      let imageUrl: string;

      if (image_path.startsWith('http://') || image_path.startsWith('https://')) {
        imageUrl = image_path;
      } else {
        if (!fs.existsSync(image_path)) {
          return {
            success: false,
            content: '',
            error: `图片文件不存在: ${image_path}`,
          };
        }

        const absolutePath = path.resolve(image_path);
        const base64 = fs.readFileSync(absolutePath).toString('base64');
        const ext = path.extname(image_path).toLowerCase().slice(1);
        const mimeType = this.getMimeType(ext);
        imageUrl = `data:${mimeType};base64,${base64}`;
      }

      const defaultPrompt = '请详细描述这张图片的内容，包括场景、人物、物品、颜色等细节。';
      const userPrompt = prompt || defaultPrompt;

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
                  url: imageUrl,
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMessage, imagePath: image_path }, '图片理解失败');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }

  private getMimeType(ext: string): string {
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      bmp: 'image/bmp',
      svg: 'image/svg+xml',
    };
    return mimeTypes[ext.toLowerCase()] || 'image/jpeg';
  }
}

export function createMultimodalTools(getConfig: MultimodalConfigResolver): {
  speechToTextTool: SpeechToTextTool;
  imageUnderstandingTool: ImageUnderstandingTool;
} {
  return {
    speechToTextTool: new SpeechToTextTool(getConfig),
    imageUnderstandingTool: new ImageUnderstandingTool(getConfig),
  };
}
