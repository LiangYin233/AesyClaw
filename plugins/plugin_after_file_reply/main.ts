import * as fs from 'fs/promises';
import { join } from 'path';
import type { InboundMessage, LLMMessage, ProcessingIntent } from '../../src/types.ts';
import type { PluginCommand, PluginContext } from '../../src/plugins/PluginManager.ts';

const AFTER_FILE_REPLY_PROMPTS = {
  describeImagesSystem: [
    '角色: 视觉助手',
    '任务: 概括图片内容。',
    '约束: 按图片顺序描述主体、场景、文字和关键信息；看不清就直说；不要编造。',
    '输出: 直接给用户可读回复。'
  ].join('\n'),
  describeImagesUser: '概括这些图片。',
  multimodalReplySystem: [
    '角色: 多模态助手',
    '任务: 基于用户文本和附件回答。',
    '约束: 优先回答用户要求；只依据文本和可见内容；不确定就直说；简洁。',
    '输出: 直接给用户回复。'
  ].join('\n')
};

type IntentType = Extract<ProcessingIntent, { type: 'status' | 'handled' | 'error' }>;

const Intent = {
  status: (reason: string): IntentType => ({ type: 'status', reason }),
  handled: (reason: string): IntentType => ({ type: 'handled', reason }),
  error: (reason: string): IntentType => ({ type: 'error', reason })
};

interface WaitingState {
  timestamp: number;
  files: string[];
}

interface AfterFileReplyOptions {
  timeoutMinutes?: number;
}

interface LoggerLike {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

interface AfterFileReplyPlugin {
  name: string;
  version: string;
  description: string;
  defaultConfig: {
    enabled: boolean;
    options: {
      timeoutMinutes: number;
    };
  };
  waitingStates: Map<string, WaitingState>;
  context: PluginContext | null;
  stateFile: string | null;
  cleanupTimer: NodeJS.Timeout | null;
  log: LoggerLike;
  tempDir: string | null;
  options: AfterFileReplyOptions;
  timeoutMs: number;
  commands: PluginCommand[];
  getKey(msg: InboundMessage): string;
  getStateFilePath(): string | null;
  loadStates(): Promise<void>;
  saveStates(): Promise<void>;
  onLoad(context: PluginContext): Promise<void>;
  onUnload(): Promise<void>;
  cleanupExpired(): void;
  hasFile(msg: InboundMessage): boolean;
  appendUniqueFiles(targetFiles: string[], newFiles?: string[]): void;
  buildMultimodalContent(text: string, files: string[]): LLMMessage['content'];
  callMultimodalLLM(systemPrompt: string, userText: string, files: string[], logLabel: string): Promise<string>;
  clearWaitingState(key: string): Promise<void>;
  getErrorMessage(error: unknown): string;
  onMessage(msg: InboundMessage): Promise<InboundMessage | null>;
}

const plugin: AfterFileReplyPlugin = {
  name: 'plugin_after_file_reply',
  version: '1.0.0',
  description: '用户发送文件后等待文本描述再发送给LLM',
  defaultConfig: {
    enabled: false,
    options: {
      timeoutMinutes: 5
    }
  },

  waitingStates: new Map<string, WaitingState>(),
  context: null,
  stateFile: null,
  cleanupTimer: null,
  log: console,
  tempDir: null,
  options: {},
  timeoutMs: 5 * 60 * 1000,

  getKey(msg: InboundMessage): string {
    return `${msg.channel}:${msg.chatId}:${msg.senderId}`;
  },

  getStateFilePath(): string | null {
    if (!this.stateFile && this.tempDir) {
      this.stateFile = join(this.tempDir, 'after_file_reply_states.json');
    }
    return this.stateFile;
  },

  async loadStates(): Promise<void> {
    try {
      const filePath = this.getStateFilePath();
      if (!filePath) {
        return;
      }

      const data = await fs.readFile(filePath, 'utf-8');
      const states = JSON.parse(data) as Record<string, WaitingState>;
      const now = Date.now();

      for (const [key, state] of Object.entries(states)) {
        if (now - state.timestamp > this.timeoutMs) {
          continue;
        }
        this.waitingStates.set(key, state);
      }
    } catch {
      // File doesn't exist or is invalid, ignore
    }
  },

  async saveStates(): Promise<void> {
    try {
      const filePath = this.getStateFilePath();
      if (!filePath) {
        return;
      }

      const states = Object.fromEntries(this.waitingStates);
      await fs.writeFile(filePath, JSON.stringify(states), 'utf-8');
    } catch (error) {
      this.log.error('Failed to save states:', error);
    }
  },

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    this.tempDir = context.tempDir;

    if (context.logger) {
      this.log = context.logger.child({ prefix: 'after_file_reply' });
    }

    this.options = context.options || {};
    this.timeoutMs = (this.options.timeoutMinutes || 5) * 60 * 1000;

    await this.loadStates();
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 60000);
  },

  async onUnload(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  },

  cleanupExpired(): void {
    const now = Date.now();
    let changed = false;

    for (const [key, state] of this.waitingStates) {
      if (now - state.timestamp > this.timeoutMs) {
        this.waitingStates.delete(key);
        changed = true;
      }
    }

    if (changed) {
      void this.saveStates();
    }
  },

  hasFile(msg: InboundMessage): boolean {
    return !!(msg.media && msg.media.length > 0);
  },

  appendUniqueFiles(targetFiles: string[], newFiles: string[] = []): void {
    const existing = new Set(targetFiles);
    for (const file of newFiles) {
      if (!existing.has(file)) {
        targetFiles.push(file);
        existing.add(file);
      }
    }
  },

  buildMultimodalContent(text: string, files: string[]): LLMMessage['content'] {
    return [
      { type: 'text', text },
      ...files.map((fileUrl) => ({
        type: 'image_url' as const,
        image_url: { url: fileUrl }
      }))
    ];
  },

  async callMultimodalLLM(systemPrompt: string, userText: string, files: string[], logLabel: string): Promise<string> {
    const agent = this.context?.agent;
    if (!agent) {
      throw new Error('Agent not available');
    }

    const content = this.buildMultimodalContent(userText, files);
    const response = await agent.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ], { allowTools: false });
    const reply = response.content?.trim() || '';

    this.log.debug('Multimodal reply generated', { logLabel, contentLength: reply.length, fileCount: files.length });
    return reply;
  },

  async clearWaitingState(key: string): Promise<void> {
    this.waitingStates.delete(key);
    await this.saveStates();
  },

  getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  },

  commands: [
    {
      name: 'qxdd',
      description: '取消当前等待，放弃已发送的文件',
      matcher: { type: 'exact', value: '/qxdd' },
      async handler(msg: InboundMessage, _args: string[]): Promise<InboundMessage> {
        const key = plugin.getKey(msg);
        const state = plugin.waitingStates.get(key);

        if (!state) {
          return { ...msg, content: '当前无等待发送的文件' };
        }

        const fileCount = state.files.length;
        await plugin.clearWaitingState(key);

        return { ...msg, content: `已取消等待，放弃了 ${fileCount} 个文件` };
      }
    },
    {
      name: 'zjfs',
      description: '直接发送已收集的文件给AI',
      matcher: { type: 'exact', value: '/zjfs' },
      async handler(msg: InboundMessage, _args: string[]): Promise<InboundMessage> {
        const key = plugin.getKey(msg);
        const state = plugin.waitingStates.get(key);

        if (!state) {
          return { ...msg, content: '当前无等待发送的文件' };
        }

        const files = state.files;
        plugin.log.info('Direct multimodal processing started', { fileCount: files.length });

        try {
          const reply = await plugin.callMultimodalLLM(
            AFTER_FILE_REPLY_PROMPTS.describeImagesSystem,
            AFTER_FILE_REPLY_PROMPTS.describeImagesUser,
            files,
            '/zjfs'
          );

          if (!reply) {
            return {
              ...msg,
              content: '抱歉，AI 未能生成回复。请重试。'
            };
          }

          await plugin.clearWaitingState(key);
          return { ...msg, content: reply };
        } catch (error) {
          plugin.log.error('/zjfs failed:', error);

          return {
            ...msg,
            content: `处理失败：${plugin.getErrorMessage(error)}`
          };
        }
      }
    }
  ],

  async onMessage(msg: InboundMessage): Promise<InboundMessage> {
    const key = this.getKey(msg);
    const state = this.waitingStates.get(key);

    this.log.debug('After-file message received', { key, hasState: !!state, mediaCount: msg.media?.length || 0 });

    if (state) {
      if (this.hasFile(msg)) {
        this.appendUniqueFiles(state.files, msg.media || []);
        await this.saveStates();

        return {
          ...msg,
          content: `已添加文件，当前共${state.files.length}个文件。请继续发送文件或发送文本描述`,
          intent: Intent.status('等待用户发送更多文件或文本描述')
        };
      }

      if (msg.content.trim()) {
        const files = state.files;

        this.log.info('Multimodal reply requested', { key, fileCount: files.length });

        try {
          const reply = await this.callMultimodalLLM(
            AFTER_FILE_REPLY_PROMPTS.multimodalReplySystem,
            msg.content,
            files,
            'after_file_reply'
          );

          if (!reply) {
            this.log.warn('LLM returned empty content');
            await this.clearWaitingState(key);
            return {
              ...msg,
              content: '抱歉，AI 未能生成回复。请重试或使用 /zjfs 命令。',
              intent: Intent.error('LLM 返回空内容')
            };
          }

          await this.clearWaitingState(key);
          return { ...msg, content: reply, intent: Intent.handled('插件已调用 LLM 并获得回复') };
        } catch (error) {
          const message = this.getErrorMessage(error);
          this.log.error('LLM call failed:', error);

          return {
            ...msg,
            content: `处理失败：${message}。请重试或使用 /qxdd 取消。`,
            intent: Intent.error(`LLM 调用失败: ${message}`)
          };
        }
      }

      return msg;
    }

    if (!this.hasFile(msg)) {
      return msg;
    }

    const files = msg.media || [];
    const uniqueFiles = [...new Set(files)];
    const fileCount = uniqueFiles.length;
    this.log.info('Waiting state created', { key, fileCount });

    if (fileCount > 0) {
      this.waitingStates.set(key, {
        files: uniqueFiles,
        timestamp: Date.now()
      });
      await this.saveStates();

      return {
        ...msg,
        content: `已收到${fileCount}个文件，请发送文本描述，或发送 /qxdd 取消等待，/zjfs 直接发送`,
        intent: Intent.status('等待用户发送文本描述')
      };
    }

    return msg;
  }
};

export default plugin;
