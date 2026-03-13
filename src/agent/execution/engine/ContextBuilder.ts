import type { LLMMessage, InboundFile } from '../../../types.js';
import fs from 'fs';
import { extname } from 'path';
import { isVisionableFile } from './vision.js';
import { buildAgentSystemPrompt } from './prompts.js';

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
};

export class ContextBuilder {
  private workspace: string;
  private systemPrompt: string;
  private skillsPrompt: string;
  private currentChannel?: string;
  private currentChatId?: string;
  private currentMessageType?: 'private' | 'group';

  constructor(workspace: string, systemPrompt?: string, skillsPrompt?: string) {
    this.workspace = workspace;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant.';
    this.skillsPrompt = skillsPrompt || '';
  }

  setSkillsPrompt(prompt: string): void {
    this.skillsPrompt = prompt;
  }

  getSkillsPrompt(): string {
    return this.skillsPrompt;
  }

  getWorkspace(): string {
    return this.workspace;
  }

  setCurrentContext(channel?: string, chatId?: string, messageType?: 'private' | 'group'): void {
    this.currentChannel = channel;
    this.currentChatId = chatId;
    this.currentMessageType = messageType;
  }

  build(
    history: any[],
    currentMessage: string,
    media?: string[],
    files?: InboundFile[]
  ): LLMMessage[] {
    const systemSections = [this.buildSystemPrompt()];

    for (const message of history) {
      if (message.role === 'system' && typeof message.content === 'string' && message.content.trim()) {
        systemSections.push(message.content.trim());
      }
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemSections.join('\n\n') },
      ...history.filter(m => ['user', 'assistant'].includes(m.role)),
      { role: 'user', content: this.buildUserContent(currentMessage, media, files) }
    ];
    return messages;
  }

  private buildSystemPrompt(): string {
    const now = new Date();
    const prompt = this.systemPrompt
      .replace(/\{\{\s*current_time\s*\}\}/g, now.toISOString())
      .replace(/\{\{\s*current_date\s*\}\}/g, now.toLocaleString())
      .replace(/\{\{\s*current_hour\s*\}\}/g, now.toLocaleTimeString())
      .replace(/\{\{\s*timezone\s*\}\}/g, Intl.DateTimeFormat().resolvedOptions().timeZone)
      .replace(/\{\{\s*cwd\s*\}\}/g, this.workspace)
      .replace(/\{\{\s*os\s*\}\}/g, process.platform);

    const context = this.currentChannel && this.currentChatId && this.currentMessageType
      ? `${this.currentChannel}:${this.currentMessageType}:${this.currentChatId}`
      : undefined;

    return buildAgentSystemPrompt({
      basePrompt: prompt,
      workspace: this.workspace,
      context,
      skillsPrompt: this.skillsPrompt
    });
  }

  private buildUserContent(
    message: string,
    media?: string[],
    files?: InboundFile[]
  ): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    const hasMedia = media && media.length > 0;
    const hasVisionableFiles = files && files.some(isVisionableFile);

    if (hasMedia || hasVisionableFiles) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: message }
      ];

      // 添加图片 URL
      if (media) {
        for (const imageUrl of media) {
          const resolvedUrl = this.resolveVisionImageUrl(imageUrl);
          if (resolvedUrl) {
            content.push({ type: 'image_url', image_url: { url: resolvedUrl } });
          }
        }
      }

      // 添加图片文件
      if (files) {
        for (const file of files) {
          if (file.localPath && isVisionableFile(file)) {
            const resolvedUrl = this.resolveVisionImageUrl(file.localPath);
            if (resolvedUrl) {
              content.push({ type: 'image_url', image_url: { url: resolvedUrl } });
            }
          }
        }
      }

      return content;
    }
    return message;
  }

  private resolveVisionImageUrl(input: string): string | null {
    if (!input) {
      return null;
    }

    if (input.startsWith('data:image/')) {
      return input;
    }

    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input;
    }

    const localPath = input.startsWith('file://') ? input.slice(7) : input;
    if (!fs.existsSync(localPath)) {
      return null;
    }

    const ext = extname(localPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';
    const buffer = fs.readFileSync(localPath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  }
}
