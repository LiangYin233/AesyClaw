import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { renderMarkdownToImage } from './render.ts';

const MD_PATTERN = /(^```[\s\S]*?\n```$)|(^\$\$[\s\S]*?\$\$$)|(\$(?:\\.|[^\n$])+\$)|(^#{1-6}\s+\S.+$)|(^>\s+\S.+$)|(^\s{0,3}[-*+]\s+\S.+$)|(^\s{0,3}\d+\.\s+\S.+$)|(^\|[^\n]*\|[^\n]*$)|(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))|(^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$)/m;
const THINK_TAG_PATTERN = /<think>([\s\S]*?)<\/think>|<thinking>([\s\S]*?)<\/thinking>/gi;

interface Md2ImgOptions {
  minLength: number;
  scale: number;
  excludedChannels: string[];
}

interface ConversationRoundSources {
  currentRoundSources: string[];
  lastCompletedRoundSources: string[];
}

function normalizeThinkingText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function extractThinkingTags(content: string): { content: string; reasoning: string } {
  if (!content) {
    return { content: '', reasoning: '' };
  }

  const reasoningParts: string[] = [];
  const cleanedContent = content.replace(THINK_TAG_PATTERN, (_match, thinkContent: string, thinkingContent: string) => {
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

function isMarkdown(text: string): boolean {
  return MD_PATTERN.test(text);
}

function getConversationKey(channel: string, chatId: string): string {
  return `${channel}:${chatId}`;
}

function createConversationRoundSources(): ConversationRoundSources {
  return {
    currentRoundSources: [],
    lastCompletedRoundSources: []
  };
}

async function renderToImage(tempDir: string, text: string, scale: number): Promise<string> {
  const outputDir = path.join(tempDir, 'md2img');
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `md2img_${randomUUID()}.png`);
  await renderMarkdownToImage(text, outputPath, scale.toString());
  return outputPath;
}

export default {
  name: 'plugin_md2img',
  version: '1.0.0',
  author: 'aesyclaw_official',
  description: '将 Markdown 自动转换为图片',
  toolsCount: 0,
  defaultConfig: {
    enabled: false,
    options: {
      minLength: 50,
      scale: 1.0,
      excludedChannels: []
    }
  },
  setup(ctx) {
    // 获取配置的工具函数，每次调用都会读取最新配置
    const getConfig = (): Md2ImgOptions => {
      const opts = ctx.getOptions();
      return {
        minLength: opts.minLength ?? 50,
        scale: Math.max(0.5, Math.min(3.0, opts.scale ?? 1.0)),
        excludedChannels: opts.excludedChannels ?? []
      };
    };
    const roundSources = new Map<string, ConversationRoundSources>();

    const getRoundSources = (channel: string, chatId: string): ConversationRoundSources => {
      const key = getConversationKey(channel, chatId);
      let state = roundSources.get(key);
      if (!state) {
        state = createConversationRoundSources();
        roundSources.set(key, state);
      }
      return state;
    };

    ctx.commands.register({
      name: 'md2img_text',
      description: '发送当前会话上一轮实际进入 md2img 转图的原始文本',
      matcher: { type: 'exact', value: '/text' },
      execute: async (message) => {
        const state = getRoundSources(message.channel, message.chatId);
        const sources = [...state.currentRoundSources];

        if (sources.length === 0) {
          await ctx.sendMessage({
            channel: message.channel,
            chatId: message.chatId,
            content: '上一轮没有可恢复的 md2img 源文本',
            messageType: message.messageType
          }, { skipHooks: true });
          return;
        }

        for (const source of sources) {
          await ctx.sendMessage({
            channel: message.channel,
            chatId: message.chatId,
            content: source,
            messageType: message.messageType
          }, { skipHooks: true });
        }
      }
    });

    ctx.hooks.messageIn.transform((message) => {
      const state = getRoundSources(message.channel, message.chatId);
      state.lastCompletedRoundSources = [...state.currentRoundSources];
      state.currentRoundSources = [];
      return message;
    });

    ctx.hooks.messageOut.transform(async (message) => {
      const config = getConfig();

      // 检查 channel 是否在排除列表中
      // 支持两种格式:
      // - "channelName" - 排除整个 channel (如 "onebot")
      // - "channelName:chatId" - 排除特定聊天 (如 "onebot:123456")
      const isExcluded = config.excludedChannels.some((excluded) => {
        // 精确匹配 channel:chatId 格式
        if (excluded.includes(':')) {
          return excluded === `${message.channel}:${message.chatId}`;
        }
        // 只匹配 channel 名称
        return excluded === message.channel;
      });
      if (isExcluded) {
        return message;
      }

      const extracted = extractThinkingTags(message.content || '');
      const mergedReasoning = [message.reasoning_content, extracted.reasoning]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join('\n\n')
        .trim();

      const baseMessage = extracted.reasoning
        ? {
            ...message,
            content: extracted.content,
            reasoning_content: mergedReasoning || undefined
          }
        : message;

      if (!baseMessage.content || baseMessage.content.length < config.minLength) {
        return baseMessage;
      }

      if (!isMarkdown(baseMessage.content)) {
        return baseMessage;
      }

      try {
        let markdownContent = baseMessage.content;
        if (mergedReasoning) {
          const thinkingBlock = `\n\n> ${mergedReasoning.replace(/\n/g, '\n> ')}\n`;
          markdownContent = thinkingBlock + markdownContent;
        }

        const imagePath = await renderToImage(ctx.tempDir, markdownContent, config.scale);
        const state = getRoundSources(baseMessage.channel, baseMessage.chatId);
        state.currentRoundSources.push(baseMessage.content);
        const originalMedia = baseMessage.media && baseMessage.media.length > 0
          ? [...baseMessage.media]
          : undefined;

        if (originalMedia && originalMedia.length > 0) {
          setImmediate(() => {
            void ctx.sendMessage({
              channel: baseMessage.channel,
              chatId: baseMessage.chatId,
              content: '',
              messageType: baseMessage.messageType,
              media: originalMedia
            }, { skipHooks: true }).catch((_error: unknown) => {
            });
          });
        }

        return {
          ...baseMessage,
          content: '',
          media: [imagePath]
        };
      } catch {
        return baseMessage;
      }
    });

    return () => {
      roundSources.clear();
    };
  }
};
