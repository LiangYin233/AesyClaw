import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const plugin = {
  name: 'after_file_reply',
  version: '1.0.0',
  description: '用户发送文件后等待文本描述再发送给LLM',
  defaultConfig: {
    enabled: false,
    options: {
      debug_log: false,
      timeoutMinutes: 5
    }
  },

  waitingStates: new Map(),
  context: null,
  stateFile: null,

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
    } catch (e) {
    }
  },

  async saveStates() {
    try {
      const filePath = this.getStateFilePath();
      const states = Object.fromEntries(this.waitingStates);
      await fs.writeFile(filePath, JSON.stringify(states), 'utf-8');
    } catch (e) {
    }
  },

  async onLoad(context) {
    this.context = context;
    this.options = context.options || {};
    this.debug = this.options.debug_log || false;
    this.timeoutMs = (this.options.timeoutMinutes || 5) * 60 * 1000;
    
    await this.loadStates();
    setInterval(() => this.cleanupExpired(), 60000);
  },

  cleanupExpired() {
    const now = Date.now();
    for (const [key, state] of this.waitingStates) {
      if (now - state.timestamp > this.timeoutMs) {
        this.waitingStates.delete(key);
        this.saveStates();
      }
    }
  },

  hasFile(msg) {
    return !!(msg.media && msg.media.length > 0);
  },

  log(...args) {
    if (this.debug) {
      this.context?.logger?.debug('[after_file_reply]', ...args);
    }
  },

  commands: [
    {
      name: 'qxdd',
      description: '取消当前等待，放弃已发送的文件',
      pattern: /^\/qxdd$/,
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
      pattern: /^\/zjfs$/,
      async handler(msg) {
        const key = plugin.getKey(msg);
        const state = plugin.waitingStates.get(key);
        
        if (!state) {
          return { ...msg, content: '当前无等待发送的文件' };
        }
        
        const files = state.files;
        const fileList = files.map((f, i) => `[文件${i + 1}: ${f}]`).join('\n');
        
        const response = await plugin.context.agent.callLLM([
          { role: 'user', content: `${fileList}\n\n请描述这些图片的内容` }
        ], { allowTools: false });
        
        plugin.waitingStates.delete(key);
        plugin.saveStates();
        
        return { ...msg, content: response.content };
      }
    }
  ],

  async onMessage(msg) {
    const key = this.getKey(msg);
    const state = this.waitingStates.get(key);

    this.log(`onMessage: key=${key}, hasState=${!!state}, media=${JSON.stringify(msg.media)}`);

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
        const fileList = files.map((f, i) => `[文件${i + 1}: ${f}]`).join('\n');
        
        const response = await this.context.agent.callLLM([
          { role: 'user', content: `${fileList}\n\n${msg.content}` }
        ]);
        
        this.waitingStates.delete(key);
        await this.saveStates();
        
        return { ...msg, content: response.content };
      }
      
      return msg;
    }

    // 无等待状态时
    if (!this.hasFile(msg)) {
      return msg;
    }

    // 收到文件：进入等待状态
    const files = msg.media || [];
    this.log(`New state: files=${JSON.stringify(files)}`);
    const uniqueFiles = [...new Set(files)];
    const fileCount = uniqueFiles.length;
    this.log(`After dedup: uniqueFiles.length=${fileCount}`);
    
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
