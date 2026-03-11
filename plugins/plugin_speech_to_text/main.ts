import { join } from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';

// Intent 辅助对象，用于创建语义化的处理意图
const Intent = {
  error: (reason) => ({ type: 'error', reason })
};

const plugin: any = {
  name: 'plugin_speech_to_text',
  version: '1.0.0',
  description: '转写语音为文本。',

  tools: [
    {
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
      execute: async (params) => {
        const { file_path } = params;
        // 验证文件存在
        try {
          await fs.access(file_path);
        } catch {
          return `错误：文件不存在或路径无效: ${file_path}`;
        }
        // 调用已有的 transcribe 方法
        try {
          const result = await plugin.transcribe(file_path);
          return result;
        } catch (error) {
          return `转写失败: ${error.message}`;
        }
      }
    }
  ],

  log: console,
  config: {},
  downloadDir: null,

  defaultConfig: {
    enabled: false,
    options: {
      provider: 'openai',
      model: 'whisper-1',
      downloadTimeout: 30000,
      transcriptionTimeout: 60000
    }
  },

  async onLoad(context) {
    this.log = context.logger?.child({ prefix: 'speech_to_text' }) || console;

    const options = context.options || {};
    const providerName = options.provider || 'openai';
    const providerConfig = context.config?.providers?.[providerName];

    if (!providerConfig?.apiKey) {
      this.log.warn(`Provider ${providerName} not configured or missing API key`);
    }

    this.config = {
      apiKey: providerConfig?.apiKey || '',
      apiBase: providerConfig?.apiBase || 'https://api.openai.com/v1',
      model: options.model || 'whisper-1',
      downloadTimeout: options.downloadTimeout || 30000,
      transcriptionTimeout: options.transcriptionTimeout || 60000
    };

    this.downloadDir = join(context.tempDir, 'speech_to_text');
    await fs.mkdir(this.downloadDir, { recursive: true }).catch(() => {});

    if (this.config.apiKey) {
      this.log.info('Speech-to-text plugin loaded');
    }
  },

  async onUnload() {
    if (!this.downloadDir) return;
    try {
      const files = await fs.readdir(this.downloadDir);
      await Promise.all(files.map(f => fs.unlink(join(this.downloadDir, f)).catch(() => {})));
    } catch {}
  },

  async downloadAudio(url, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);

      const hash = createHash('md5').update(url + Date.now()).digest('hex').substring(0, 8);
      const filepath = join(this.downloadDir, `audio_${Date.now()}_${hash}.mp3`);

      if (!response.body) {
        throw new Error('Download response body is empty');
      }

      await pipeline(Readable.fromWeb(response.body as any), createWriteStream(filepath));
      return filepath;
    } catch (error) {
      throw error.name === 'AbortError' ? new Error('Download timeout') : error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async transcribe(audioPath) {
    if (!this.config.apiKey) throw new Error('API key not configured');

    const url = `${this.config.apiBase}/audio/transcriptions`;
    const audioBuffer = await fs.readFile(audioPath);
    const formData = new FormData();
    formData.append('file', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'audio.mp3');
    formData.append('model', this.config.model);
    formData.append('response_format', 'json');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.transcriptionTimeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error ${response.status}: ${error.substring(0, 100)}`);
      }

      const text = await response.text();
      try {
        return JSON.parse(text).text?.trim() || text.trim();
      } catch {
        return text.trim();
      }
    } catch (error) {
      throw error.name === 'AbortError' ? new Error('Transcription timeout') : error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async onMessage(msg) {
    try {
      this.log.info(`[STT] onMessage called, content="${msg.content}", files=${JSON.stringify(msg.files?.map(f => ({ type: f.type, url: f.url?.substring(0, 50) })))}`);

      // Detect audio URL from files or rawEvent
      let audioUrl = msg.files?.find(f => f.type === 'audio')?.url;

      if (!audioUrl && msg.rawEvent?.message) {
        const voiceSegment = msg.rawEvent.message.find(seg => seg.type === 'record');
        audioUrl = voiceSegment?.data?.url || voiceSegment?.data?.file;
        this.log.debug(`[STT] Found audio URL from rawEvent: ${audioUrl?.substring(0, 50)}`);
      }

      // Handle [语音] placeholder without URL
      if (!audioUrl) {
        if (msg.content === '[语音]') {
          this.log.warn(`[STT] Voice message detected but no URL found`);
          return { ...msg, content: '[语音消息 - 无法获取音频链接]', intent: Intent.error('音频 URL 不存在') };
        }
        this.log.debug(`[STT] Not a voice message, passing through`);
        return msg;
      }

      // Check API configuration
      if (!this.config.apiKey) {
        this.log.warn('Voice message detected but API key not configured');
        return { ...msg, content: '[语音消息 - 转写服务未配置]', intent: Intent.error('API key 未配置') };
      }

      this.log.info(`Processing voice message from ${msg.senderId}`);

      // Download and transcribe
      let audioPath;
      try {
        audioPath = await this.downloadAudio(audioUrl, this.config.downloadTimeout);
        const transcription = await this.transcribe(audioPath);

        this.log.info(`Transcription successful: ${transcription.substring(0, 50)}...`);
        return {
          ...msg,
          content: transcription,
          files: undefined,  // 清除文件信息
          media: undefined,  // 清除媒体信息
          metadata: { ...msg.metadata, transcribed: true, originalType: 'voice' }
        };
      } catch (error) {
        this.log.error('Transcription failed:', error.message);
        return { ...msg, content: `[语音消息 - ${error.message}]`, intent: Intent.error(`转写失败: ${error.message}`) };
      } finally {
        if (audioPath) await fs.unlink(audioPath).catch(() => {});
      }
    } catch (error) {
      this.log.error('Unexpected error:', error);
      return { ...msg, content: '[语音消息 - 处理失败]', intent: Intent.error(`处理失败: ${error.message}`) };
    }
  }
};

export default plugin;
