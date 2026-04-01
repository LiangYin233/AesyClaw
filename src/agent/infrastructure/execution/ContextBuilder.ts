import type { LLMMessage, InboundFile } from '../../../types.js';
import fs from 'fs';
import { extname } from 'path';
import { isVisionableFile } from './ExecutionTypes.js';
import { formatLocalClock, formatLocalDateTime, formatLocalTimestamp, getCurrentTimezone } from '../../../platform/observability/logging.js';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant. Now is {{current_date}}. Running on {{os}}.';

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
};

export type VisionUserContent = string | Array<{
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}>;

export class ContextBuilder {
  private workspace: string;
  private systemPrompt: string;
  private skillsPrompt: string;
  private currentChannel?: string;
  private currentChatId?: string;
  private currentMessageType?: 'private' | 'group';
  private includeRuntimeContext: boolean;

  constructor(
    workspace: string,
    systemPrompt?: string,
    skillsPrompt?: string,
    includeRuntimeContext: boolean = true
  ) {
    this.workspace = workspace;
    this.systemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.skillsPrompt = skillsPrompt || '';
    this.includeRuntimeContext = includeRuntimeContext;
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
    const basePrompt = this.systemPrompt
      .replace(/\{\{\s*current_time\s*\}\}/g, formatLocalTimestamp(now))
      .replace(/\{\{\s*current_date\s*\}\}/g, formatLocalDateTime(now))
      .replace(/\{\{\s*current_hour\s*\}\}/g, formatLocalClock(now))
      .replace(/\{\{\s*timezone\s*\}\}/g, getCurrentTimezone())
      .replace(/\{\{\s*cwd\s*\}\}/g, this.workspace)
      .replace(/\{\{\s*os\s*\}\}/g, process.platform);

    if (this.includeRuntimeContext === false) {
      return basePrompt.trim();
    }

    const context = this.currentChannel && this.currentChatId && this.currentMessageType
      ? `${this.currentChannel}:${this.currentMessageType}:${this.currentChatId}`
      : undefined;

    const sections = [
      basePrompt.trim(),
      `Workspace: ${this.workspace}`,
      context ? `Context: ${context}` : '',
      this.skillsPrompt?.trim() || ''
    ].filter(Boolean);

    return sections.join('\n');
  }

  private buildUserContent(
    message: string,
    media?: string[],
    files?: InboundFile[]
  ): VisionUserContent {
    return buildVisionUserContent(message, media, files);
  }
}

export function buildVisionUserContent(
  message: string,
  media?: string[],
  files?: InboundFile[]
): VisionUserContent {
  const hasMedia = media && media.length > 0;
  const hasVisionableFiles = files && files.some(isVisionableFile);

  if (hasMedia || hasVisionableFiles) {
    const content: Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
      };
    }> = [
      { type: 'text', text: message }
    ];

    if (media) {
      for (const imageUrl of media) {
        const resolvedUrl = resolveVisionImageUrl(imageUrl);
        if (resolvedUrl) {
          content.push({ type: 'image_url', image_url: { url: resolvedUrl } });
        }
      }
    }

    if (files) {
      for (const file of files) {
        if (file.localPath && isVisionableFile(file)) {
          const resolvedUrl = resolveVisionImageUrl(file.localPath);
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

export function resolveVisionImageUrl(input: string): string | null {
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
