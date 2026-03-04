const plugin = {
  name: 'after_file_reply',
  version: '1.0.0',
  description: '用户发送文件后等待文本描述再发送给LLM',
  defaultConfig: {
    options: {
      debug_log: false
    }
  },

  waitingStates: new Map(),
  context: null,

  async onLoad(context) {
    this.context = context;
    this.options = context.options || {};
    this.debug = this.options.debug_log || false;
  },

  hasFile(msg) {
    return !!(msg.media && msg.media.length > 0);
  },

  log(...args) {
    if (this.debug) {
      this.context?.logger?.info('[after_file_reply]', ...args);
    }
  },

  commands: [
    {
      name: 'qxdd',
      description: '取消当前等待，放弃已发送的文件',
      pattern: /^\/qxdd$/,
      handler: async (msg) => {
        const key = `${msg.channel}:${msg.chatId}:${msg.senderId}`;
        const state = this.waitingStates.get(key);
        
        if (!state) {
          return { ...msg, content: '当前没有等待发送的文件', replyOnly: true };
        }
        
        const fileCount = state.files.length;
        this.waitingStates.delete(key);
        this.log(`用户取消等待，放弃 ${fileCount} 个文件`);
        
        return { ...msg, content: `已取消等待，放弃了 ${fileCount} 个文件`, replyOnly: true };
      }
    },
    {
      name: 'zjfs',
      description: '直接发送已收集的文件给AI',
      pattern: /^\/zjfs$/,
      handler: async (msg) => {
        const key = `${msg.channel}:${msg.chatId}:${msg.senderId}`;
        const state = this.waitingStates.get(key);
        
        if (!state) {
          return { ...msg, content: '当前没有等待发送的文件', replyOnly: true };
        }
        
        const fileCount = state.files.length;
        const fileList = state.files.map((f, i) => `[文件${i + 1}: ${f}]`).join(', ');
        this.waitingStates.delete(key);
        
        this.log(`直接发送 ${fileCount} 个文件`);
        
        return {
          ...msg,
          content: `${fileList}\n\n请描述这些文件`
        };
      }
    }
  ],

  async onMessage(msg) {
    const key = `${msg.channel}:${msg.chatId}:${msg.senderId}`;

    const state = this.waitingStates.get(key);

    if (state) {
      if (this.hasFile(msg)) {
        const newFiles = msg.media || [];
        state.files.push(...newFiles);
        const fileCount = state.files.length;
        
        this.log(`追加文件，当前共 ${fileCount} 个`);
        
        return {
          ...msg,
          content: `已添加文件，当前共${fileCount}个文件。请继续发送文件或发送文本描述`,
          replyOnly: true
        };
      }

      if (msg.content.trim()) {
        const fileCount = state.files.length;
        const fileList = state.files.map((f, i) => `[文件${i + 1}: ${f}]`).join(', ');
        this.waitingStates.delete(key);
        
        this.log(`发送文本描述，共 ${fileCount} 个文件: ${msg.content.substring(0, 30)}...`);
        
        return {
          ...msg,
          content: `${fileList}\n\n${msg.content}`
        };
      }
      
      return msg;
    }

    if (!this.hasFile(msg)) {
      return msg;
    }

    const files = msg.media || [];
    const fileCount = files.length;
    
    if (fileCount > 0) {
      this.waitingStates.set(key, {
        unified_msg_origin: key,
        files,
        fileTypes: []
      });
      
      this.log(`收到 ${fileCount} 个文件，进入等待状态`);
      
      return {
        ...msg,
        content: `已收到${fileCount}个文件，请发送文本描述，或发送 /qxdd 取消等待，/zjfs 直接发送`,
        replyOnly: true
      };
    }

    return msg;
  }
};

export default plugin;
