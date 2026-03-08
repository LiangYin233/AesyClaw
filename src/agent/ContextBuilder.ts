import type { LLMMessage } from '../types.js';

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
    media?: string[]
  ): LLMMessage[] {
    const messages: LLMMessage[] = [
      { role: 'system', content: this.buildSystemPrompt() },
      ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
      { role: 'user', content: this.buildUserContent(currentMessage, media) }
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
    media?: string[]
  ): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
    if (media && media.length > 0) {
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: message }
      ];
      for (const imageUrl of media) {
        content.push({ type: 'image_url', image_url: { url: imageUrl } });
      }
      return content;
    }
    return message;
  }
}
