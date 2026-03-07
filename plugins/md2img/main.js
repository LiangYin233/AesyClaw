import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const MD_PATTERN = /(^```[\s\S]*?\n```$)|(^\$\$[\s\S]*?\$\$$)|(\$(?:\\.|[^\n$])+\$)|(^#{1-6}\s+\S.+$)|(^>\s+\S.+$)|(^\s{0,3}[-*+]\s+\S.+$)|(^\s{0,3}\d+\.\s+\S.+$)|(^\|[^\n]*\|[^\n]*$)|(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))|(^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$)/m;

let log = console;

const plugin = {
  name: 'md2img',
  version: '1.0.0',
  description: '将 Markdown 自动转换为图片',
  defaultConfig: {
    enabled: false,
    options: {
      minLength: 50,
      verboseLog: false,
      scale: 1.0
    }
  },

  config: {
    minLength: 50,
    verboseLog: false,
    scale: 1.0
  },

  context: null,  // 保存插件上下文

  async onLoad(context) {
    this.context = context;  // 保存上下文以便在 onResponse 中使用

    if (context.logger) {
      log = context.logger.child({ prefix: 'md2img' });
    }

    const options = context.options || {};
    this.config = {
      minLength: options?.minLength ?? 50,
      verboseLog: options?.verboseLog ?? false,
      scale: Math.max(0.5, Math.min(3.0, options?.scale ?? 1.0))
    };

    if (this.config.verboseLog) {
      log.info('Plugin loaded with config:', this.config);
    }
  },

  async onResponse(msg) {
    if (this.config.verboseLog) {
      log.info(`onResponse called: content length=${msg.content?.length || 0}, has media=${!!(msg.media && msg.media.length > 0)}`);
    }

    if (!msg.content || msg.content.length < this.config.minLength) {
      if (this.config.verboseLog) {
        log.info(`Skipped: content too short (${msg.content?.length || 0} < ${this.config.minLength})`);
      }
      return msg;
    }

    if (!this.isMarkdown(msg.content)) {
      if (this.config.verboseLog) {
        log.info(`Skipped: not markdown. Content preview: ${msg.content.substring(0, 100)}`);
      }
      return msg;
    }

    try {
      let markdownContent = msg.content;

      if (msg.reasoning_content) {
        const thinkingBlock = `\n\n> ${msg.reasoning_content.replace(/\n/g, '\n> ')}\n`;
        markdownContent = thinkingBlock + markdownContent;
        if (this.config.verboseLog) {
          log.info(`Added thinking block: ${msg.reasoning_content.length} chars`);
        }
      }

      if (this.config.verboseLog) {
        log.info(`Converting markdown: ${markdownContent.length} chars`);
      }

      const imagePath = await this.renderToImage(markdownContent);

      // 检查是否有原始 media
      const hasOriginalMedia = msg.media && msg.media.length > 0;
      const originalMedia = hasOriginalMedia ? [...msg.media] : null;

      // 设置 md2img 生成的图片
      msg.media = [imagePath];
      msg.content = '';

      if (this.config.verboseLog) {
        log.info('Markdown converted successfully:', imagePath);
      }

      // 如果有原始 media，需要分开发送
      if (hasOriginalMedia && originalMedia) {
        if (this.config.verboseLog) {
          log.info(`Original media detected (${originalMedia.length} files), will send separately`);
        }

        // 使用 setImmediate 确保在当前消息发送后再发送原始 media
        setImmediate(async () => {
          try {
            // 构建第二条消息（只包含原始 media）
            const secondMsg = {
              channel: msg.channel,
              chatId: msg.chatId,
              content: ' ',  // 空格作为占位符
              messageType: msg.messageType,
              media: originalMedia
            };

            // 通过 agent 的 eventBus 发送
            if (this.context?.agent?.eventBus) {
              await this.context.agent.eventBus.publishOutbound(secondMsg);
              if (this.config.verboseLog) {
                log.info(`Sent original media separately (${originalMedia.length} files)`);
              }
            } else {
              log.warn('Cannot send original media: eventBus not available');
            }
          } catch (error) {
            log.error('Failed to send original media:', error);
          }
        });
      }
    } catch (error) {
      log.error('Conversion failed:', error);
    }

    return msg;
  },

  isMarkdown(text) {
    return MD_PATTERN.test(text);
  },

  async renderToImage(text) {
    const tmpdir = os.tmpdir();
    const mdFile = path.join(tmpdir, `md2img_${randomUUID()}.md`);
    const outputFile = path.join(tmpdir, `md2img_${randomUUID()}.png`);
    
    try {
      await fs.writeFile(mdFile, text, 'utf-8');
      
      await this.runRenderScript(mdFile, outputFile);
      
      await fs.unlink(mdFile);
      
      return outputFile;
    } catch (error) {
      try {
        await fs.unlink(mdFile);
      } catch {}
      throw error;
    }
  },

  runRenderScript(mdFile, outputFile) {
    return new Promise((resolve, reject) => {
      const pluginDir = path.dirname(fileURLToPath(import.meta.url));
      const renderScript = path.join(pluginDir, 'render.js');
      
      log.debug('Plugin dir:', pluginDir, 'Render script:', renderScript);
      
      const child = spawn('node', [renderScript, mdFile, outputFile, this.config.scale.toString()], {
        stdio: 'pipe'
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Render script failed with code ${code}`));
        } else {
          resolve();
        }
      });

      child.on('error', reject);
    });
  }
};

export default plugin;
