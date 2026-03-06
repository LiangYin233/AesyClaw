# AesyClaw 插件开发指南

## 概述

AesyClaw 插件系统基于现代化的依赖注入架构，提供强大的扩展能力：

**核心特性：**
- 注册自定义工具 (Tools)
- 添加消息中间件
- 拦截和处理入站/出站消息
- 拦截 Agent 处理前后的事件
- 拦截工具调用结果
- 注册命令处理器

**架构优势：**
- **Hook Pipeline**: 所有插件钩子通过统一的管道执行，提供超时保护（默认 5 秒）
- **依赖注入**: 基于 DI 容器的模块化架构，插件可以访问所有核心服务
- **类型安全**: 完整的 TypeScript 类型定义
- **错误隔离**: 单个插件错误不会影响其他插件或系统运行

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
    // 注意: 此方法有 5 秒超时限制
    // 避免长时间阻塞操作，如大文件处理或网络请求
    return msg; // 返回处理后的消息
  },
  
  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    return msg;
  },

  // Agent 钩子
  async onAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    // 在 Agent 处理消息前调用，可修改 messages
    // 超时限制: 5 秒
  },
  
  async onAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    // 在 Agent 生成响应后调用
  },

  // 工具调用钩子
  async onToolCall(toolName: string, params: Record<string, any>, result: string): Promise<string | void> {
    // 可以修改工具返回结果，返回 undefined 表示不修改
    // 超时限制: 5 秒
    return result;
  },

  // 工具调用前钩子（新增）
  async onBeforeToolCall(toolName: string, params: Record<string, any>): Promise<Record<string, any> | void> {
    // 在工具调用前修改参数
    // 返回新参数对象或 undefined 保持原参数
    return params;
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
      pattern: /^!help/,
      handler: async (msg) => {
        // 处理命令，返回 null 表示不拦截消息
        return null;
      }
    }
  ],

  // 注册工具
  tools: [],

  // 中间件
  middleware: []
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

```typescript
import type { Plugin, PluginCommand, InboundMessage } from 'aesyclaw';

const helpCommand: PluginCommand = {
  name: 'help',
  description: '显示帮助信息',
  pattern: /^!help/,
  handler: async (msg: InboundMessage) => {
    const helpText = `
可用命令:
- !help - 显示帮助
- !status - 查看状态
- !ping - 测试连接
    `.trim();
    
    // 通过 eventBus 发送回复消息
    // 返回 null 表示继续正常处理，不拦截消息
    return null;
  }
};

const echoCommand: PluginCommand = {
  name: 'echo',
  description: '回显消息',
  pattern: /^!echo\s+(.+)/,
  handler: async (msg: InboundMessage) => {
    const match = msg.content.match(/^!echo\s+(.+)/);
    if (match) {
      // 修改消息内容
      msg.content = match[1];
    }
    return msg;
  }
};

const myPlugin: Plugin = {
  name: 'commands',
  version: '1.0.0',
  commands: [helpCommand, echoCommand]
};

export default myPlugin;
```

### 4. 消息中间件

```typescript
import type { Plugin, Middleware, InboundMessage } from 'aesyclaw';

const authMiddleware: Middleware = async (msg, next) => {
  // 验证用户
  const allowedUsers = ['123456789', '987654321'];
  
  if (!allowedUsers.includes(msg.senderId)) {
    console.log('用户不在白名单:', msg.senderId);
    return; // 不调用 next() 阻止消息
  }
  
  await next();
};

const myPlugin: Plugin = {
  name: 'auth',
  version: '1.0.0',
  middleware: [authMiddleware]
};

export default myPlugin;
```

### 5. 消息拦截

```typescript
import type { Plugin, InboundMessage, OutboundMessage } from 'aesyclaw';

const filterPlugin: Plugin = {
  name: 'filter',
  version: '1.0.0',
  
  async onMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    // 过滤敏感词
    const sensitiveWords = ['敏感词1', '敏感词2'];
    
    for (const word of sensitiveWords) {
      if (msg.content.includes(word)) {
        msg.content = msg.content.replace(word, '***');
      }
    }
    
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

### 6. Agent 钩子

```typescript
import type { Plugin, InboundMessage, LLMMessage, LLMResponse } from 'aesyclaw';

const agentPlugin: Plugin = {
  name: 'agent-hook',
  version: '1.0.0',
  
  async onAgentBefore(msg: InboundMessage, messages: LLMMessage[]): Promise<void> {
    // 在消息发送给 LLM 之前修改上下文
    // 添加系统提示
    messages.unshift({
      role: 'system',
      content: '你是一个友好的助手，请用中文回答。'
    });
  },
  
  async onAgentAfter(msg: InboundMessage, response: LLMResponse): Promise<void> {
    // 在收到 LLM 响应后处理
    console.log('LLM 响应:', response.content);
    console.log('推理内容:', response.reasoning_content);
  }
};

export default agentPlugin;
```

### 7. 工具调用拦截

```typescript
import type { Plugin } from 'aesyclaw';

const toolHookPlugin: Plugin = {
  name: 'tool-hook',
  version: '1.0.0',
  
  async onToolCall(toolName: string, params: Record<string, any>, result: string): Promise<string | void> {
    console.log(`工具 ${toolName} 执行结果:`, result);
    
    // 可以修改返回结果
    if (toolName === 'some_tool') {
      // return '修改后的结果';
    }
    
    // 返回 undefined 保持原结果
    return undefined;
  }
};

export default toolHookPlugin;
```

### 8. 错误处理

```typescript
import type { Plugin, PluginErrorContext } from 'aesyclaw';

const errorHandlerPlugin: Plugin = {
  name: 'error-handler',
  version: '1.0.0',
  
  async onError(error: Error, context: PluginErrorContext): Promise<void> {
    console.error('Plugin error:', {
      message: error.message,
      type: context.type,     // 'message' | 'tool' | 'response' | 'agent'
      plugin: context.plugin, // 触发错误的插件名
      data: context.data
    });
  }
};

export default errorHandlerPlugin;
```

### 9. 响应处理（生成图片等）

`onResponse` 可以在 AI 响应发送前对其进行修改，例如将 Markdown 渲染为图片：

```typescript
import type { Plugin, OutboundMessage } from 'aesyclaw';

const md2imgPlugin: Plugin = {
  name: 'md2img',
  version: '1.0.0',
  defaultConfig: {
    enabled: false,
    options: {
      minLength: 50,
      scale: 1.0
    }
  },
  
  async onLoad(options) {
    this.options = {
      minLength: options?.minLength ?? 50,
      scale: Math.max(0.5, Math.min(3.0, options?.scale ?? 1.0))
    };
  },
  
  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    // 只处理足够长的消息
    if (!msg.content || msg.content.length < this.options.minLength) {
      return msg;
    }
    
    // 检查是否为 Markdown
    if (!this.isMarkdown(msg.content)) {
      return msg;
    }
    
    try {
      // 渲染为图片
      const imagePath = await this.renderToImage(msg.content);
      
      // 添加图片到消息
      msg.media = msg.media || [];
      msg.media.push(imagePath);
      
      return msg;
    } catch (error) {
      console.error('Markdown to image failed:', error);
      return msg; // 返回原始消息
    }
  },
  
  isMarkdown(text) {
    return /^#{1,6}\s/m.test(text) || /^\*\*.*\*\*/m.test(text);
  },
  
  async renderToImage(markdown) {
    // 渲染实现...
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
  name: string;           // 命令名称
  description: string;    // 命令描述
  pattern?: RegExp;       // 正则匹配模式
  handler: (msg: InboundMessage) => Promise<InboundMessage | null>;
}
```

### Middleware

```typescript
type Middleware = (msg: InboundMessage, next: () => Promise<void>) => Promise<void>;
```

### PluginContext

```typescript
interface PluginContext {
  config: Config;              // 当前配置
  eventBus: EventBus;         // 事件总线
  agent: AgentLoop | null;    // Agent 实例
  workspace: string;          // 工作目录
  registerTool(tool: Tool): void;    // 注册工具
  getToolRegistry(): ToolRegistry;  // 获取工具注册表
  logger: typeof logger;       // 日志实例
  sendMessage(channel: string, chatId: string, content: string, messageType?: 'private' | 'group'): Promise<void>;
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

1. **工具命名**: 使用前缀区分不同插件的工具，如 `filesystem_read`, `weather_get`
2. **错误处理**: 在 execute 中捕获异常并返回有意义的错误消息
3. **参数验证**: 使用 validate 方法验证参数
4. **异步执行**: 工具执行应该是异步的，避免阻塞
5. **日志记录**: 使用 `context.logger` 记录关键操作
6. **默认配置**: 设置 `defaultConfig` 让插件可配置但默认禁用
7. **命令优先级**: 先注册的命令先匹配，使用简单的正则模式
8. **中间件顺序**: 先注册的中间件先执行
9. **Hook 超时**: 所有 hook 方法有 5 秒超时限制，避免长时间阻塞操作
10. **错误隔离**: Hook 中的错误会被捕获并记录，不会影响其他插件

## 架构说明

### Hook Pipeline

所有插件的 hook 方法通过 `HookPipeline` 执行，提供以下保障：

- **超时保护**: 每个 hook 默认 5 秒超时，防止插件阻塞系统
- **错误隔离**: 单个插件错误不会影响其他插件执行
- **顺序执行**: Hook 按插件注册顺序依次执行
- **结果传递**: 每个 hook 的返回值会传递给下一个 hook

```typescript
// Hook 执行流程示例
onMessage: msg1 → Plugin A → msg2 → Plugin B → msg3 → 返回最终消息
```

### 依赖注入

插件通过 `PluginContext` 访问核心服务：

```typescript
interface PluginContext {
  config: Config;              // 配置服务
  eventBus: EventBus;         // 事件总线
  agent: AgentLoop | null;    // Agent 实例
  workspace: string;          // 工作目录
  registerTool(tool: Tool): void;
  getToolRegistry(): ToolRegistry;
  logger: typeof logger;
  sendMessage(...): Promise<void>;
}
```

所有服务通过 DI 容器管理，确保依赖关系清晰且可测试。

## 完整配置示例

```yaml
server:
  host: 0.0.0.0
  apiPort: 18792      # API Server 端口
  apiEnabled: true    # 是否启用 API Server（默认 true）

agent:
  defaults:
    model: "gpt-4o"
    provider: "openai"
    contextMode: "channel"  # session | channel | global
    memoryWindow: 50        # 记忆窗口大小
    systemPrompt: "你是一个有用的助手"
    maxToolIterations: 40

plugins:
  filesystem:
    enabled: true
  shell:
    enabled: true
    options:
      allowedCommands:
        - "git"
        - "npm"
        - "node"
  weather:
    enabled: false
```

## 性能与限制

### Hook 超时机制

所有插件 hook 方法都有超时保护：

- **默认超时**: 5 秒
- **超时行为**: Hook 执行超时会抛出错误，但不会影响其他插件
- **适用范围**: `onMessage`, `onResponse`, `onAgentBefore`, `onAgentAfter`, `onToolCall`, `onBeforeToolCall`

**最佳实践：**
```typescript
// ❌ 不推荐：长时间阻塞操作
async onMessage(msg) {
  await heavyComputation(); // 可能超过 5 秒
  return msg;
}

// ✅ 推荐：异步处理或快速返回
async onMessage(msg) {
  // 快速处理
  msg.metadata = { processed: true };

  // 长时间操作放到后台
  this.processInBackground(msg).catch(console.error);

  return msg;
}
```

### 错误处理

插件错误会被自动捕获和记录：

```typescript
// 插件 A 抛出错误
async onMessage(msg) {
  throw new Error('Something went wrong');
}

// 系统行为：
// 1. 记录错误日志
// 2. 继续执行插件 B、C...
// 3. 不影响消息处理流程
```

使用 `onError` hook 自定义错误处理：

```typescript
async onError(error: Error, context: PluginErrorContext) {
  // 发送告警、记录到数据库等
  await this.sendAlert(error.message);
}
```

### 资源管理

插件应该正确管理资源：

```typescript
const myPlugin: Plugin = {
  name: 'resource-plugin',

  async onLoad() {
    // 初始化资源
    this.connection = await createConnection();
  },

  async onUnload() {
    // 清理资源
    await this.connection?.close();
  }
};
```

### 并发控制

多个消息可能同时触发插件 hook，注意并发安全：

```typescript
const myPlugin: Plugin = {
  name: 'counter',
  counter: 0,

  async onMessage(msg) {
    // ❌ 不安全：竞态条件
    this.counter++;

    // ✅ 安全：使用原子操作或锁
    await this.incrementCounter();
    return msg;
  }
};
```

## 调试技巧

### 启用详细日志

```typescript
const myPlugin: Plugin = {
  name: 'debug-plugin',

  async onMessage(msg) {
    this.context.logger.debug('Processing message:', {
      content: msg.content,
      sender: msg.senderId
    });
    return msg;
  }
};
```

### 测试插件

```typescript
// 创建测试消息
const testMsg: InboundMessage = {
  channel: 'test',
  senderId: '123',
  chatId: '456',
  content: 'test message',
  timestamp: new Date()
};

// 测试 hook
const result = await myPlugin.onMessage(testMsg);
console.log('Result:', result);
```

### 常见问题

**Q: 插件 hook 没有被调用？**
- 检查插件是否在 `config.yaml` 中启用
- 确认 hook 方法名拼写正确
- 查看日志是否有加载错误

**Q: Hook 超时怎么办？**
- 将长时间操作移到后台执行
- 使用缓存减少计算时间
- 考虑使用工具而非 hook 处理复杂逻辑

**Q: 如何在插件间共享数据？**
- 使用 `context.eventBus` 发送自定义事件
- 通过消息的 `metadata` 字段传递数据
- 使用外部存储（数据库、Redis 等）

**Q: 插件加载顺序重要吗？**
- Hook 按插件注册顺序执行
- 命令匹配按注册顺序，先匹配先处理
- 中间件按注册顺序执行
