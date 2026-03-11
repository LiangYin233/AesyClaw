import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { renderMarkdownToImage } from './render.js';

const MD_PATTERN = /(^```[\s\S]*?\n```$)|(^\$\$[\s\S]*?\$\$$)|(\$(?:\\.|[^\n$])+\$)|(^#{1-6}\s+\S.+$)|(^>\s+\S.+$)|(^\s{0,3}[-*+]\s+\S.+$)|(^\s{0,3}\d+\.\s+\S.+$)|(^\|[^\n]*\|[^\n]*$)|(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))|(^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$)/m;
const THINK_TAG_PATTERN = /<think>([\s\S]*?)<\/think>|<thinking>([\s\S]*?)<\/thinking>/gi;

let log = console;

function normalizeThinkingText(text) {
  if (!text) return '';

  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function extractThinkingTags(content) {
  if (!content) {
    return { content: '', reasoning: '' };
  }

  const reasoningParts = [];
  const cleanedContent = content.replace(THINK_TAG_PATTERN, (_, thinkContent, thinkingContent) => {
    const extracted = normalizeThinkingText(thinkContent || thinkingContent || '');
    if (extracted) {
      reasoningParts.push(extracted);
    }
    return '';
  });

  return {
    content: cleanedContent.replace(/\n{3,}/g, '\n\n').trim(),
    reasoning: reasoningParts.join('\n\n').trim()
  };
}

const plugin: any = {
  name: 'plugin_md2img',
  version: '1.0.0',
  description: '将 Markdown 自动转换为图片',
  defaultConfig: {
    enabled: false,
    options: {
      minLength: 50,
      scale: 1.0
    }
  },

  config: {
    minLength: 50,
    scale: 1.0
  },

  context: null,  // 保存插件上下文
  tempDir: null,

  async onLoad(context) {
    this.context = context;  // 保存上下文以便在 onResponse 中使用
    this.tempDir = context.tempDir;

    if (context.logger) {
      log = context.logger.child({ prefix: 'md2img' });
    }

    const options = context.options || {};
    this.config = {
      minLength: options?.minLength ?? 50,
      scale: Math.max(0.5, Math.min(3.0, options?.scale ?? 1.0))
    };

    log.info('Plugin loaded with config:', this.config);
  },

  async onResponse(msg) {
    log.debug(`onResponse called: content length=${msg.content?.length || 0}, has media=${!!(msg.media && msg.media.length > 0)}`);

    const extracted = extractThinkingTags(msg.content || '');
    const mergedReasoning = [msg.reasoning_content, extracted.reasoning]
      .filter((part) => typeof part === 'string' && part.trim().length > 0)
      .join('\n\n')
      .trim();

    if (extracted.reasoning) {
      msg.content = extracted.content;
      msg.reasoning_content = mergedReasoning;
      log.debug(`Extracted thinking tags: ${extracted.reasoning.length} chars`);
    }

    if (!msg.content || msg.content.length < this.config.minLength) {
      log.debug(`Skipped: content too short (${msg.content?.length || 0} < ${this.config.minLength})`);
      return msg;
    }

    if (!this.isMarkdown(msg.content)) {
      log.debug(`Skipped: not markdown. Content preview: ${msg.content.substring(0, 100)}`);
      return msg;
    }

    try {
      let markdownContent = msg.content;

      if (mergedReasoning) {
        const thinkingBlock = `\n\n> ${mergedReasoning.replace(/\n/g, '\n> ')}\n`;
        markdownContent = thinkingBlock + markdownContent;
        log.debug(`Added thinking block: ${mergedReasoning.length} chars`);
      }

      log.debug(`Converting markdown: ${markdownContent.length} chars`);

      const imagePath = await this.renderToImage(markdownContent);

      // 检查是否有原始 media
      const hasOriginalMedia = msg.media && msg.media.length > 0;
      const originalMedia = hasOriginalMedia ? [...msg.media] : null;

      // 设置 md2img 生成的图片
      msg.media = [imagePath];
      msg.content = '';

      log.info('Markdown converted successfully:', imagePath);

      // 如果有原始 media，需要分开发送
      if (hasOriginalMedia && originalMedia) {
        log.debug(`Original media detected (${originalMedia.length} files), will send separately`);

        // 使用 setImmediate 确保在当前消息发送后再发送原始 media
        setImmediate(async () => {
          try {
            // 构建第二条消息（只包含原始 media）
            const secondMsg = {
              channel: msg.channel,
              chatId: msg.chatId,
              content: '',  // 空内容，让 formatter 只发送 media
              messageType: msg.messageType,
              media: originalMedia
            };

            // 通过 agent 的 eventBus 发送
            if (this.context?.agent?.eventBus) {
              await this.context.agent.eventBus.publishOutbound(secondMsg);
              log.debug(`Sent original media separately (${originalMedia.length} files)`);
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
    const tmpdir = path.join(this.tempDir, 'md2img');
    await fs.mkdir(tmpdir, { recursive: true });

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

  async runRenderScript(mdFile, outputFile) {
    await renderMarkdownToImage(await fs.readFile(mdFile, 'utf-8'), outputFile, this.config.scale.toString());
  }
};

export default plugin;
