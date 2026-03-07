# AesyClaw 插件开发指南

## 概述

AesyClaw 插件系统提供强大的扩展能力：

**核心特性：**
- 注册自定义工具（Tools）
- 拦截和处理消息（onMessage, onResponse）
- 拦截 Agent 处理（onAgentBefore, onAgentAfter）
- 拦截工具调用（onBeforeToolCall, onToolCall）
- 注册命令处理器（Commands）
- 错误处理（onError）

**架构优势：**
- **Hook Pipeline**：统一的钩子执行管道，5 秒超时保护
- **依赖注入**：访问所有核心服务（EventBus, ToolRegistry, Logger 等）
- **类型安全**：完整的 TypeScript 类型定义
- **错误隔离**：单个插件错误不影响系统运行

## 插件结构

### 基本结构

```typescript
import type { Plugin, PluginContext, Tool, InboundMessage, OutboundMessage, LLMMessage, LLMResponse, PluginErrorContext } from 'aesyclaw';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '我的第一个插件',
  author: 'Your Name',
  options: {},                    // 运行时配置
  defaultConfig: {                // 默认配置
    enabled: false,
    options: {}
  },

  // 生命周期钩子
  async onLoad(options) {
    console.log('插件加载', options);
  },
  
  async onStart() {
    console.log('插件启动/启用');
  },
  
  async onStop() {
    console.log('插件停止/禁用');
  },
  
  async onUnload() {
    console.log('插件卸载');
  },

  // 消息处理
  async onMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    // 超时限制: 5 秒
    return msg;
  },

  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    return msg;
  },

  // Agent 钩子
  async onAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    // 在 Agent 处理前调用，可修改 messages
  },

  async onAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    // 在 Agent 生成响应后调用
  },

  // 工具调用钩子
  async onBeforeToolCall(toolName: string, params: Record<string, any>, context?: ToolContext): Promise<Record<string, any> | void> {
    // 在工具调用前修改参数
    return params;
  },

  async onToolCall(toolName: string, params: Record<string, any>, result: string, context?: ToolContext): Promise<string | void> {
    // 可以修改工具返回结果
    return result;
  },

  // 错误处理
  async onError(error: Error, context: PluginErrorContext): Promise<void> {
    console.error('Plugin error:', error, context);
  },

  // 命令处理器
  commands: [
    {
      name: 'help',
      description: '显示帮助信息',
      matcher: { type: 'prefix', value: '!help' },
      handler: async (msg, args) => {
        return null; // 返回 null 表示不拦截消息
      }
    }
  ],

  // 注册工具
  tools: []
};

export default myPlugin;
```

## 完整示例

### 1. 简单工具插件

```typescript
import type { Plugin, Tool } from 'aesyclaw';

const filesystemPlugin: Plugin = {
  name: 'filesystem',
  version: '1.0.0',
  description: '文件系统工具插件',
  
  tools: [
    {
      name: 'read_file',
      description: '读取文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      },
      execute: async (params) => {
        const fs = await import('fs/promises');
        return await fs.readFile(params.path, 'utf-8');
      }
    },
    {
      name: 'write_file',
      description: '写入文件内容',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '文件内容' }
        },
        required: ['path', 'content']
      },
      execute: async (params) => {
        const fs = await import('fs/promises');
        await fs.writeFile(params.path, params.content, 'utf-8');
        return '文件写入成功';
      }
    }
  ]
};

export default filesystemPlugin;
```

### 2. 带配置的插件

```typescript
import type { Plugin, PluginContext, Tool } from 'aesyclaw';

interface MyPluginOptions {
  apiKey: string;
  model?: string;
}

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  defaultConfig: {
    enabled: false,
    options: {
      apiKey: '',
      model: 'gpt-4'
    }
  },
  
  async onLoad(options) {
    const opts = this.options as MyPluginOptions;
    console.log('API Key:', opts.apiKey);
    
    // 注册工具
    this.registerTool({
      name: 'my_tool',
      description: '我的自定义工具',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' }
        },
        required: ['input']
      },
      execute: async (params, context) => {
        const apiKey = this.options.apiKey;
        return '结果';
      }
    });
  },

  // 可以通过 context.sendMessage 发送消息
  async onMessage(msg, context) {
    await context.sendMessage('onebot', msg.chatId, '收到消息: ' + msg.content);
    return msg;
  }
};

export default myPlugin;
```

### 3. 命令处理器

命令支持多种匹配模式：

```typescript
import type { Plugin, PluginCommand } from 'aesyclaw';

const myPlugin: Plugin = {
  name: 'commands',
  version: '1.0.0',
  commands: [
    {
      name: 'help',
      description: '显示帮助',
      matcher: { type: 'prefix', value: '!help' },
      handler: async (msg, args) => {
        // args 是命令参数数组
        return null;
      }
    },
    {
      name: 'echo',
      description: '回显消息',
      matcher: { type: 'regex', value: /^!echo\s+(.+)/ },
      handler: async (msg, args) => {
        msg.content = args[0]; // 修改消息内容
        return msg;
      }
    },
    {
      name: 'exact',
      description: '精确匹配',
      matcher: { type: 'exact', value: '!ping' },
      handler: async (msg, args) => {
        return null;
      }
    },
    {
      name: 'contains',
      description: '包含匹配',
      matcher: { type: 'contains', value: 'keyword' },
      handler: async (msg, args) => {
        return null;
      }
    }
  ]
};

export default myPlugin;
```

### 4. 消息拦截

```typescript
import type { Plugin, InboundMessage, OutboundMessage } from 'aesyclaw';

const filterPlugin: Plugin = {
  name: 'filter',
  version: '1.0.0',

  async onMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    // 过滤敏感词
    msg.content = msg.content.replace(/敏感词/g, '***');
    return msg;
  },

  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    // 添加前缀
    msg.content = '[Bot] ' + msg.content;
    return msg;
  }
};

export default filterPlugin;
```

### 5. Agent 钩子

```typescript
import type { Plugin, InboundMessage, LLMMessage, LLMResponse } from 'aesyclaw';

const agentPlugin: Plugin = {
  name: 'agent-hook',
  version: '1.0.0',

  async onAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    // 在消息发送给 LLM 之前修改上下文
    messages.unshift({
      role: 'system',
      content: '你是一个友好的助手。'
    });
  },

  async onAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    // 在收到 LLM 响应后处理
    console.log('LLM 响应:', response.content);
  }
};

export default agentPlugin;
```

### 6. 工具调用拦截

```typescript
import type { Plugin, ToolContext } from 'aesyclaw';

const toolHookPlugin: Plugin = {
  name: 'tool-hook',
  version: '1.0.0',

  async onBeforeToolCall(toolName: string, params: Record<string, any>, context?: ToolContext): Promise<Record<string, any> | void> {
    // 在工具调用前修改参数
    console.log(`工具 ${toolName} 调用参数:`, params);
    return params;
  },

  async onToolCall(toolName: string, params: Record<string, any>, result: string, context?: ToolContext): Promise<string | void> {
    // 修改工具返回结果
    console.log(`工具 ${toolName} 执行结果:`, result);
    return result; // 返回 undefined 保持原结果
  }
};

export default toolHookPlugin;
```

### 7. 响应处理（生成图片等）

```typescript
import type { Plugin, OutboundMessage } from 'aesyclaw';

const md2imgPlugin: Plugin = {
  name: 'md2img',
  version: '1.0.0',
  defaultConfig: {
    enabled: false,
    options: { minLength: 50, scale: 2 }
  },

  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    if (!msg.content || msg.content.length < this.options.minLength) {
      return msg;
    }

    if (!this.isMarkdown(msg.content)) {
      return msg;
    }

    try {
      const imagePath = await this.renderToImage(msg.content);
      msg.media = msg.media || [];
      msg.media.push(imagePath);
      return msg;
    } catch (error) {
      console.error('Render failed:', error);
      return msg;
    }
  },

  isMarkdown(text: string): boolean {
    return /^#{1,6}\s/m.test(text) || /^```/m.test(text);
  },

  async renderToImage(markdown: string): Promise<string> {
    // 渲染实现...
    return '/path/to/image.png';
  }
};

export default md2imgPlugin;
```

## 接口定义

### InboundMessage

```typescript
interface InboundMessage {
  channel: string;           // 渠道名称
  senderId: string;        // 发送者 ID
  chatId: string;          // 聊天 ID
  content: string;         // 消息内容
  rawEvent?: any;          // 原始事件数据
  timestamp: Date;         // 时间戳
  messageId?: string;      // 消息 ID
  media?: string[];        // 媒体文件
  sessionKey?: string;     // 会话 key
  messageType?: 'private' | 'group';
}
```

### OutboundMessage

```typescript
interface OutboundMessage {
  channel: string;              // 渠道名称
  chatId: string;               // 聊天 ID
  content: string;              // 消息内容
  reasoning_content?: string;    // 推理内容
  replyTo?: string;             // 回复消息 ID
  media?: string[];             // 媒体文件路径（如图片）
  metadata?: Record<string, any>;
  messageType?: 'private' | 'group';
}
```

### PluginErrorContext

```typescript
interface PluginErrorContext {
  type: 'message' | 'tool' | 'response' | 'agent';  // 触发错误的操作类型
  plugin?: string;                                     // 触发错误的插件名
  data?: any;                                          // 额外上下文数据
}
```

### LLMMessage

```typescript
interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}
```

### LLMResponse

```typescript
interface LLMResponse {
  content: string | null | undefined;
  reasoning_content?: string;
  toolCalls: ToolCall[];
  finishReason: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

### Tool

```typescript
interface Tool {
  name: string;           // 工具名称 (唯一标识)
  description: string;   // 工具描述 (供 AI 理解用途)
  parameters: object;    // JSON Schema 格式的参数定义
  validate?: (params: object) => string[];  // 参数验证
  execute: (params: object, context?: any) => Promise<string>;
}
```

### PluginCommand

```typescript
interface PluginCommand {
  name: string;
  description: string;
  matcher?: CommandMatcher;  // 推荐使用
  pattern?: RegExp;           // 已废弃，使用 matcher 代替
  handler: (msg: InboundMessage, args: string[]) => Promise<InboundMessage | null>;
}

type CommandMatcher =
  | { type: 'regex'; value: RegExp }
  | { type: 'prefix'; value: string }
  | { type: 'exact'; value: string }
  | { type: 'contains'; value: string };
```

### PluginContext

```typescript
interface PluginContext {
  config: Config;
  eventBus: EventBus;
  agent: AgentLoop | null;
  workspace: string;
  registerTool(tool: Tool): void;
  getToolRegistry(): ToolRegistry;
  logger: typeof logger;
  sendMessage(channel: string, chatId: string, content: string, messageType?: 'private' | 'group'): Promise<void>;
}
```

### ToolContext

```typescript
interface ToolContext {
  workspace: string;
  eventBus?: EventBus;
  source?: 'user' | 'cron';
  signal?: AbortSignal;
  chatId?: string;
  messageType?: 'private' | 'group';
  channel?: string;
}
```

#### 使用 callLLM 调用 LLM

插件可以通过 `context.agent.callLLM()` 直接调用 LLM：

```typescript
const response = await context.agent.callLLM([
  { role: 'user', content: '你好' }
], { allowTools: false });

console.log(response.content);
```

`callLLM` 参数：
- `messages`: LLMMessage[] - 消息数组
- `options`: 
  - `allowTools`: boolean - 是否允许工具调用，默认 true
  - `maxIterations`: number - 最大迭代次数
```

## 插件配置

在 `config.yaml` 中配置插件：

```yaml
plugins:
  filesystem:
    enabled: true
    options:
      basePath: "/path/to/files"
  
  my-custom-plugin:
    enabled: true
    options:
      apiKey: "${MY_API_KEY}"
```

## 插件目录结构

将插件文件放入 `plugins/` 目录：

```
plugins/
├── filesystem/
│   ├── main.js          # 入口文件 (必需)
│   └── package.json     # 依赖配置 (可选)
├── weather/
│   └── main.js
└── md2img/
    ├── main.js
    └── package.json
```

插件入口文件 `main.js` 需要导出默认 Plugin 对象：

```javascript
// plugins/my-plugin/main.js
import type { Plugin } from '../../src/types.js';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  // ... 配置
};

export default myPlugin;
```

## 最佳实践

1. **工具命名**：使用前缀区分插件工具，如 `filesystem_read`
2. **错误处理**：在 execute 中捕获异常并返回有意义的错误消息
3. **参数验证**：使用 validate 方法验证参数
4. **日志记录**：使用 `context.logger` 记录关键操作
5. **默认配置**：设置 `defaultConfig` 让插件可配置但默认禁用
6. **Hook 超时**：所有 hook 方法有 5 秒超时限制，避免长时间阻塞
7. **错误隔离**：Hook 中的错误会被捕获，不影响其他插件
8. **命令匹配器**：优先使用 `matcher` 而非 `pattern`
9. **资源管理**：在 onUnload 中清理资源（连接、定时器等）
10. **并发安全**：注意多个消息可能同时触发 hook

## 性能与限制

### Hook 超时机制

所有插件 hook 方法都有 5 秒超时保护：

```typescript
// ❌ 不推荐：长时间阻塞
async onMessage(msg) {
  await heavyComputation(); // 可能超时
  return msg;
}

// ✅ 推荐：快速返回或后台处理
async onMessage(msg) {
  msg.metadata = { processed: true };
  this.processInBackground(msg).catch(console.error);
  return msg;
}
```

### 错误处理

插件错误会被自动捕获和记录，不影响其他插件：

```typescript
async onError(error: Error, context: PluginErrorContext) {
  // 自定义错误处理
  await this.sendAlert(error.message);
}
```
