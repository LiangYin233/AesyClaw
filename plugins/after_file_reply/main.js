import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs/promises';

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

  getKey(msg) {
    return `${msg.channel}:${msg.chatId}:${msg.senderId}`;
  },

  getStateFilePath() {
    if (!this.stateFile) {
      const pluginDir = dirname(fileURLToPath(import.meta.url));
      this.stateFile = join(pluginDir, 'states.json');
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
        plugin.waitingStates.delete(key);
        plugin.saveStates();

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

        // 构建多模态消息内容
        const content = [
          { type: 'text', text: '请描述这些图片的内容' }
        ];

        // 添加图片
        for (const fileUrl of files) {
          content.push({
            type: 'image_url',
            image_url: { url: fileUrl }
          });
        }

        try {
          const response = await plugin.context.agent.callLLM([
            { role: 'user', content }
          ], { allowTools: false });

          plugin.log.debug(`/zjfs: LLM response length: ${response.content?.length || 0}`);

          if (!response.content || response.content.trim() === '') {
            return {
              ...msg,
              content: '抱歉，AI 未能生成回复。请重试。'
            };
          }

          plugin.waitingStates.delete(key);
          plugin.saveStates();

          return { ...msg, content: response.content };
        } catch (error) {
          plugin.log.error(`/zjfs failed:`, error);

          return {
            ...msg,
            content: `处理失败：${error.message}`
          };
        }
      }
    }
  ],

  async onMessage(msg) {
    const key = this.getKey(msg);
    const state = this.waitingStates.get(key);

    this.log.debug(`onMessage: key=${key}, hasState=${!!state}, media=${JSON.stringify(msg.media)}`);

    // 有等待状态时
    if (state) {
      // 收到新文件：追加
      if (this.hasFile(msg)) {
        const newFiles = msg.media || [];
        const existingSet = new Set(state.files);
        for (const f of newFiles) {
          if (!existingSet.has(f)) {
            state.files.push(f);
          }
        }

        await this.saveStates();

        return {
          ...msg,
          content: `已添加文件，当前共${state.files.length}个文件。请继续发送文件或发送文本描述`
        };
      }

      // 收到文本：发送文件+文本给 LLM
      if (msg.content.trim()) {
        const files = state.files;

        this.log.debug(`Processing text with ${files.length} files`);
        this.log.debug(`Text content: ${msg.content.substring(0, 100)}`);
        this.log.debug(`Files: ${JSON.stringify(files)}`);

        // 构建多模态消息内容
        const content = [
          { type: 'text', text: msg.content }
        ];

        // 添加图片
        for (const fileUrl of files) {
          content.push({
            type: 'image_url',
            image_url: { url: fileUrl }
          });
        }

        this.log.debug(`Calling LLM with multimodal content`);

        try {
          const response = await this.context.agent.callLLM([
            { role: 'user', content }
          ], { allowTools: false });

          this.log.debug(`LLM response received, content length: ${response.content?.length || 0}`);

          if (!response.content || response.content.trim() === '') {
            this.log.warn(`LLM returned empty content`);
            this.waitingStates.delete(key);
            await this.saveStates();
            return {
              ...msg,
              content: '抱歉，AI 未能生成回复。请重试或使用 /zjfs 命令。'
            };
          }

          this.waitingStates.delete(key);
          await this.saveStates();

          return { ...msg, content: response.content };
        } catch (error) {
          this.log.error(`LLM call failed:`, error);

          // Keep state on error so user can retry
          return {
            ...msg,
            content: `处理失败：${error.message}。请重试或使用 /qxdd 取消。`
          };
        }
      }

      return msg;
    }

    // 无等待状态时
    if (!this.hasFile(msg)) {
      return msg;
    }

    // 收到文件：进入等待状态
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
        content: `已收到${fileCount}个文件，请发送文本描述，或发送 /qxdd 取消等待，/zjfs 直接发送`
      };
    }

    return msg;
  }
};

export default plugin;
