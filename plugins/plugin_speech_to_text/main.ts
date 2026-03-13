import { join } from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';
import { definePlugin } from '../../src/plugins/index.ts';
import { preview } from '../../src/observability/index.ts';
import type { InboundFile, InboundMessage, ProcessingIntent } from '../../src/types.ts';

const Intent = {
  error: (reason: string): Extract<ProcessingIntent, { type: 'error' }> => ({ type: 'error', reason })
};

interface SpeechToTextOptions {
  provider: string;
  model: string;
  downloadTimeout: number;
  transcriptionTimeout: number;
}

interface SpeechRuntimeConfig {
  apiKey: string;
  apiBase: string;
  model: string;
  downloadTimeout: number;
  transcriptionTimeout: number;
}

function findAudioSource(message: InboundMessage): { localPath?: string; remoteUrl?: string } | null {
  const compatFile = message.files?.find((file: InboundFile) => file.type === 'audio');
  if (compatFile) {
    return {
      localPath: compatFile.localPath,
      remoteUrl: compatFile.url
    };
  }

  const projectedAudio = message.projection?.nonVisionFiles.find((resource) => resource.kind === 'audio');
  if (projectedAudio) {
    return {
      localPath: projectedAudio.localPath,
      remoteUrl: projectedAudio.remoteUrl
    };
  }

  if (Array.isArray(message.rawEvent?.message)) {
    const voiceSegment = message.rawEvent.message.find((segment: any) => segment.type === 'record');
    if (voiceSegment) {
      return {
        remoteUrl: voiceSegment.data?.url || voiceSegment.data?.file
      };
    }
  }

  return null;
}

async function downloadAudio(downloadDir: string, url: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Download response body is empty');
    }

    const hash = createHash('md5').update(url + Date.now()).digest('hex').substring(0, 8);
    const filepath = join(downloadDir, `audio_${Date.now()}_${hash}.mp3`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(filepath));
    return filepath;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Download timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribe(config: SpeechRuntimeConfig, audioPath: string): Promise<string> {
  if (!config.apiKey) {
    throw new Error('API key not configured');
  }

  const url = `${config.apiBase}/audio/transcriptions`;
  const audioBuffer = await fs.readFile(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
  formData.append('model', config.model);
  formData.append('response_format', 'json');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.transcriptionTimeout);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      },
      body: formData,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText.substring(0, 100)}`);
    }

    const text = await response.text();
    try {
      return JSON.parse(text).text?.trim() || text.trim();
    } catch {
      return text.trim();
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Transcription timeout');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default definePlugin<SpeechToTextOptions>({
  name: 'plugin_speech_to_text',
  version: '1.0.0',
  description: '转写语音为文本。',
  toolsCount: 1,
  defaultConfig: {
    enabled: false,
    options: {
      provider: 'openai',
      model: 'whisper-1',
      downloadTimeout: 30000,
      transcriptionTimeout: 60000
    }
  },
  async setup(ctx) {
    const log = ctx.logger.child('speech_to_text');
    const providerName = ctx.options.provider || 'openai';
    const providerConfig = ctx.config.providers?.[providerName];
    const config: SpeechRuntimeConfig = {
      apiKey: providerConfig?.apiKey || '',
      apiBase: providerConfig?.apiBase || 'https://api.openai.com/v1',
      model: ctx.options.model || 'whisper-1',
      downloadTimeout: ctx.options.downloadTimeout || 30000,
      transcriptionTimeout: ctx.options.transcriptionTimeout || 60000
    };
    const downloadDir = join(ctx.tempDir, 'speech_to_text');

    await fs.mkdir(downloadDir, { recursive: true }).catch(() => undefined);

    if (!providerConfig?.apiKey) {
      log.warn(`Provider ${providerName} not configured or missing API key`);
    } else {
      log.info('Speech-to-text plugin loaded', {
        provider: providerName,
        model: config.model
      });
    }

    ctx.tools.register({
      name: 'transcribe_audio',
      description: '转写音频文件为文本。',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: '音频文件路径。'
          }
        },
        required: ['file_path']
      },
      async execute(params: Record<string, any>) {
        const filePath = String(params.file_path || '');
        try {
          await fs.access(filePath);
        } catch {
          return `错误：文件不存在或路径无效: ${filePath}`;
        }

        try {
          return await transcribe(config, filePath);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return `转写失败: ${message}`;
        }
      }
    });

    ctx.hooks.messageIn.transform(async (message) => {
      try {
        const source = findAudioSource(message);
        if (!source) {
          if (message.content === '[语音]') {
            log.warn('Voice message missing audio URL', {
              senderId: message.senderId,
              chatId: message.chatId
            });
            return {
              ...message,
              content: '[语音消息 - 无法获取音频链接]',
              intent: Intent.error('音频 URL 不存在')
            };
          }
          return message;
        }

        if (!config.apiKey) {
          log.warn('Voice message detected but API key not configured');
          return {
            ...message,
            content: '[语音消息 - 转写服务未配置]',
            intent: Intent.error('API key 未配置')
          };
        }

        log.info('Voice transcription started', {
          senderId: message.senderId,
          chatId: message.chatId
        });

        let temporaryPath: string | undefined;
        try {
          const audioPath = source.localPath || await downloadAudio(downloadDir, source.remoteUrl || '', config.downloadTimeout);
          if (!source.localPath) {
            temporaryPath = audioPath;
          }

          const transcription = await transcribe(config, audioPath);
          log.info('Voice transcription completed', {
            senderId: message.senderId,
            chatId: message.chatId,
            preview: preview(transcription)
          });

          return {
            ...message,
            content: transcription,
            files: undefined,
            media: undefined,
            metadata: {
              ...message.metadata,
              transcribed: true,
              originalType: 'voice'
            }
          };
        } catch (error) {
          const messageText = error instanceof Error ? error.message : String(error);
          log.error('Voice transcription failed', {
            senderId: message.senderId,
            chatId: message.chatId,
            error: messageText
          });
          return {
            ...message,
            content: `[语音消息 - ${messageText}]`,
            intent: Intent.error(`转写失败: ${messageText}`)
          };
        } finally {
          if (temporaryPath) {
            await fs.unlink(temporaryPath).catch(() => undefined);
          }
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        log.error('Voice processing failed', {
          senderId: message.senderId,
          chatId: message.chatId,
          error: messageText
        });
        return {
          ...message,
          content: '[语音消息 - 处理失败]',
          intent: Intent.error(`处理失败: ${messageText}`)
        };
      }
    });

    return async () => {
      await fs.rm(downloadDir, { recursive: true, force: true }).catch(() => undefined);
    };
  }
});
