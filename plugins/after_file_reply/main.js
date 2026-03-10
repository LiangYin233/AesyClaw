import { join } from 'path';
import * as fs from 'fs/promises';

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

const Intent = {
  status: (reason) => ({ type: 'status', reason }),
  handled: (reason) => ({ type: 'handled', reason }),
  error: (reason) => ({ type: 'error', reason })
};

const plugin = {
  name: 'after_file_reply',
  version: '1.0.0',
  description: '用户发送文件后等待文本描述再发送给LLM',
  defaultConfig: {
    enabled: false,
    options: {
      timeoutMinutes: 5
    }
  },

  waitingStates: new Map(),
  context: null,
  stateFile: null,
  cleanupTimer: null,
  log: console,
  tempDir: null,

  getKey(msg) {
    return `${msg.channel}:${msg.chatId}:${msg.senderId}`;
  },

  getStateFilePath() {
    if (!this.stateFile && this.tempDir) {
      this.stateFile = join(this.tempDir, 'after_file_reply_states.json');
    }
    return this.stateFile;
  },

  async loadStates() {
    try {
      const filePath = this.getStateFilePath();
      const data = await fs.readFile(filePath, 'utf-8');
      const states = JSON.parse(data);
      const now = Date.now();
      for (const [key, state] of Object.entries(states)) {
        if (now - state.timestamp > this.timeoutMs) {
          continue;
        }
        this.waitingStates.set(key, state);
      }
    } catch (error) {
      // File doesn't exist or is invalid, ignore
    }
  },

  async saveStates() {
    try {
      const filePath = this.getStateFilePath();
      const states = Object.fromEntries(this.waitingStates);
      await fs.writeFile(filePath, JSON.stringify(states), 'utf-8');
    } catch (error) {
      this.log.error('Failed to save states:', error);
    }
  },

  async onLoad(context) {
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

  async onUnload() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  },

  cleanupExpired() {
    const now = Date.now();
    let changed = false;
    for (const [key, state] of this.waitingStates) {
      if (now - state.timestamp > this.timeoutMs) {
        this.waitingStates.delete(key);
        changed = true;
      }
    }
    if (changed) {
      this.saveStates();
    }
  },

  hasFile(msg) {
    return !!(msg.media && msg.media.length > 0);
  },

  appendUniqueFiles(targetFiles, newFiles = []) {
    const existing = new Set(targetFiles);
    for (const file of newFiles) {
      if (!existing.has(file)) {
        targetFiles.push(file);
        existing.add(file);
      }
    }
  },

  buildMultimodalContent(text, files) {
    return [
      { type: 'text', text },
      ...files.map((fileUrl) => ({
        type: 'image_url',
        image_url: { url: fileUrl }
      }))
    ];
  },

  async callMultimodalLLM(systemPrompt, userText, files, logLabel) {
    const content = this.buildMultimodalContent(userText, files);
    const response = await this.context.agent.callLLM([
      { role: 'system', content: systemPrompt },
      { role: 'user', content }
    ], { allowTools: false });
    const reply = response.content?.trim() || '';

    this.log.debug(`${logLabel}: LLM response length: ${reply.length}`);
    return reply;
  },

  async clearWaitingState(key) {
    this.waitingStates.delete(key);
    await this.saveStates();
  },

  getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  },

  commands: [
    {
      name: 'qxdd',
      description: '取消当前等待，放弃已发送的文件',
      matcher: { type: 'exact', value: '/qxdd' },
      async handler(msg) {
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
      async handler(msg) {
        const key = plugin.getKey(msg);
        const state = plugin.waitingStates.get(key);

        if (!state) {
          return { ...msg, content: '当前无等待发送的文件' };
        }

        const files = state.files;
        plugin.log.debug(`/zjfs: Processing ${files.length} files`);

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

  async onMessage(msg) {
    const key = this.getKey(msg);
    const state = this.waitingStates.get(key);

    this.log.debug(`onMessage: key=${key}, hasState=${!!state}, media=${JSON.stringify(msg.media)}`);

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

        this.log.debug(`Processing text with ${files.length} files`);
        this.log.debug(`Text content: ${msg.content.substring(0, 100)}`);
        this.log.debug(`Files: ${JSON.stringify(files)}`);

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
    this.log.debug(`New state: files=${JSON.stringify(files)}`);
    const uniqueFiles = [...new Set(files)];
    const fileCount = uniqueFiles.length;
    this.log.debug(`After dedup: uniqueFiles.length=${fileCount}`);

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
