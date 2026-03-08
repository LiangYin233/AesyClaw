import { join } from 'path';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createHash } from 'crypto';

const plugin = {
  name: 'speech_to_text',
  version: '1.0.0',
  description: '使用 OpenAI 兼容的 STT API 转录语音消息',

  log: console,
  config: {
    provider: 'openai',
    model: 'whisper-1',
    downloadTimeout: 30000,
    transcriptionTimeout: 60000
  },
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
    if (context.logger) {
      this.log = context.logger.child({ prefix: 'speech_to_text' });
    }

    const options = context.options || {};
    const providerName = options.provider || 'openai';
    const providerConfig = context.config?.providers?.[providerName];

    if (!providerConfig || !providerConfig.apiKey) {
      this.log.warn(`Provider ${providerName} not configured or missing API key`);
    }

    this.config = {
      provider: providerName,
      apiKey: providerConfig?.apiKey || '',
      apiBase: providerConfig?.apiBase || 'https://api.openai.com/v1',
      model: options.model || 'whisper-1',
      downloadTimeout: options.downloadTimeout || 30000,
      transcriptionTimeout: options.transcriptionTimeout || 60000
    };

    // Setup download directory in temp
    this.downloadDir = join(context.tempDir, 'speech_to_text');
    try {
      await fs.mkdir(this.downloadDir, { recursive: true });
    } catch (error) {
      this.log.error('Failed to create download directory:', error);
    }

    if (this.config.apiKey) {
      this.log.info('Speech-to-text plugin loaded');
    }
  },

  async onUnload() {
    // Cleanup download directory
    if (this.downloadDir) {
      try {
        const files = await fs.readdir(this.downloadDir);
        for (const file of files) {
          await fs.unlink(join(this.downloadDir, file)).catch(() => {});
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  },

  async downloadAudio(url, timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      this.log.debug(`Downloading audio from: ${url}`);
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }

      // Generate unique filename
      const hash = createHash('md5').update(url + Date.now()).digest('hex').substring(0, 8);
      const filename = `audio_${Date.now()}_${hash}.mp3`;
      const filepath = join(this.downloadDir, filename);

      // Save to file
      const fileStream = createWriteStream(filepath);
      await pipeline(response.body, fileStream);

      this.log.debug(`Audio downloaded to: ${filepath}`);
      return filepath;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Download timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  async transcribe(audioPath, retries = 3) {
    if (!this.config.apiKey) {
      throw new Error('API key not configured');
    }

    const url = `${this.config.apiBase}/audio/transcriptions`;

    for (let attempt = 1; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.transcriptionTimeout);

      try {
        this.log.debug(`Transcription attempt ${attempt}/${retries}`);

        // Read audio file
        const audioBuffer = await fs.readFile(audioPath);
        const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

        // Build form data
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.mp3');
        formData.append('model', this.config.model);
        formData.append('response_format', 'text');

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: formData,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorBody = await response.text();
          const statusCode = response.status;

          // Retry on specific errors
          if ([408, 429, 500, 502, 503, 504].includes(statusCode) && attempt < retries) {
            const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
            this.log.warn(`Transcription failed with ${statusCode}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(`API error ${statusCode}: ${errorBody.substring(0, 200)}`);
        }

        const text = await response.text();
        this.log.debug(`Transcription successful: ${text.substring(0, 100)}...`);
        return text.trim();
      } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          if (attempt < retries) {
            this.log.warn('Transcription timeout, retrying...');
            continue;
          }
          throw new Error('Transcription timeout');
        }

        if (attempt === retries) {
          throw error;
        }
      }
    }

    throw new Error('Transcription failed after all retries');
  },

  async onMessage(msg) {
    try {
      // Check if message contains voice/audio
      let audioUrl = null;

      // OneBot: check for record type in rawEvent.message
      if (msg.rawEvent?.message && Array.isArray(msg.rawEvent.message)) {
        const voiceSegment = msg.rawEvent.message.find(seg => seg.type === 'record');
        if (voiceSegment) {
          audioUrl = voiceSegment.data?.url || voiceSegment.data?.file;
          this.log.debug(`Detected OneBot voice message: ${audioUrl}`);
        }
      }

      // Feishu: check for audio files
      if (!audioUrl && msg.files && Array.isArray(msg.files)) {
        const audioFile = msg.files.find(f =>
          f.name?.match(/\.(mp3|wav|m4a|ogg|opus|flac)$/i) ||
          f.url?.match(/\.(mp3|wav|m4a|ogg|opus|flac)$/i)
        );
        if (audioFile) {
          audioUrl = audioFile.url;
          this.log.debug(`Detected Feishu audio file: ${audioUrl}`);
        }
      }

      // No voice message detected in rawEvent, but check if content is [语音]
      if (!audioUrl) {
        // If content is [语音], it means this is a voice message but we can't process it
        if (msg.content === '[语音]') {
          this.log.warn('Voice message detected in content but no audio URL found');
          return {
            ...msg,
            content: '[语音消息 - 无法获取音频链接]',
            skipLLM: true
          };
        }
        // Not a voice message, pass through
        return msg;
      }

      // Check if API is configured
      if (!this.config.apiKey) {
        this.log.warn('Voice message detected but API key not configured');
        return {
          ...msg,
          content: '[语音消息 - 转写服务未配置]',
          skipLLM: true
        };
      }

      this.log.info(`Processing voice message from ${msg.senderId}`);

      // Download audio
      let audioPath;
      try {
        audioPath = await this.downloadAudio(audioUrl, this.config.downloadTimeout);
      } catch (error) {
        this.log.error('Failed to download audio:', error.message);
        return {
          ...msg,
          content: `[语音消息 - 下载失败: ${error.message}]`,
          skipLLM: true
        };
      }

      // Transcribe
      let transcription;
      try {
        transcription = await this.transcribe(audioPath);
      } catch (error) {
        this.log.error('Failed to transcribe audio:', error.message);
        return {
          ...msg,
          content: `[语音消息 - 转写失败: ${error.message}]`,
          skipLLM: true
        };
      } finally {
        // Cleanup downloaded file
        try {
          await fs.unlink(audioPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }

      // Replace message content with transcription
      this.log.info(`Transcription successful: ${transcription.substring(0, 50)}...`);
      return {
        ...msg,
        content: transcription,
        metadata: {
          ...msg.metadata,
          transcribed: true,
          originalType: 'voice'
        }
      };
    } catch (error) {
      this.log.error('Unexpected error in onMessage:', error);
      return {
        ...msg,
        content: '[语音消息 - 处理失败]',
        skipLLM: true
      };
    }
  }
};

export default plugin;
