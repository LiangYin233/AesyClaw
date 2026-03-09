import type { LLMMessage, InboundFile } from '../types.js';
import { isVisionableFile } from './visionFileUtils.js';

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
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
      { role: 'user', content: this.buildUserContent(currentMessage, media, files) }
    ];
    return messages;
  }

  private buildSystemPrompt(): string {
    const now = new Date();
    let prompt = this.systemPrompt
      .replace(/\{\{\s*current_time\s*\}\}/g, now.toISOString())
      .replace(/\{\{\s*current_date\s*\}\}/g, now.toLocaleString())
      .replace(/\{\{\s*current_hour\s*\}\}/g, now.toLocaleTimeString())
      .replace(/\{\{\s*timezone\s*\}\}/g, Intl.DateTimeFormat().resolvedOptions().timeZone)
      .replace(/\{\{\s*cwd\s*\}\}/g, this.workspace)
      .replace(/\{\{\s*os\s*\}\}/g, process.platform);

    const sections = [`# AesyClaw`, prompt, `## Workspace: ${this.workspace}`];

    if (this.currentChannel && this.currentChatId && this.currentMessageType) {
      sections.push(`## Current Context: ${this.currentChannel}:${this.currentMessageType}:${this.currentChatId}`);
    }

    if (this.skillsPrompt) {
      sections.push(this.skillsPrompt);
    }

    return sections.join('\n\n');
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
          content.push({ type: 'image_url', image_url: { url: imageUrl } });
        }
      }

      // 添加图片文件
      if (files) {
        for (const file of files) {
          if (file.localPath && isVisionableFile(file)) {
            content.push({ type: 'image_url', image_url: { url: `file://${file.localPath}` } });
          }
        }
      }

      return content;
    }
    return message;
  }
}
