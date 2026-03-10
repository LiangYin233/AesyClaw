# 插件开发指南

## 概述

AesyClaw 插件系统提供扩展能力：

- 注册工具（Tools）
- 消息拦截（onMessage, onResponse）
- Agent 钩子（onAgentBefore, onAgentAfter）
- 工具调用拦截（onBeforeToolCall, onToolCall）
- 命令处理器（Commands）
- 错误处理（onError）

## 插件结构

```typescript
import type { Plugin } from 'aesyclaw';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '插件描述',
  author: 'Your Name',

  defaultConfig: {
    enabled: false,
    options: {}
  },

  // 生命周期
  async onLoad(options) {},
  async onStart() {},
  async onStop() {},
  async onUnload() {},

  // 消息处理
  async onMessage(msg) { return msg; },
  async onResponse(msg) { return msg; },

  // Agent 钩子
  async onAgentBefore(msg, messages) {},
  async onAgentAfter(msg, response) {},

  // 工具调用
  async onBeforeToolCall(toolName, params, context) { return params; },
  async onToolCall(toolName, params, result, context) { return result; },

  // 错误处理
  async onError(error, context) {},

  // 命令
  commands: [{
    name: 'help',
    description: '显示帮助',
    matcher: { type: 'prefix', value: '!help' },
    handler: async (msg, args) => null
  }],

  // 工具
  tools: []
};

export default myPlugin;
```

## 示例

### 工具插件

```typescript
const filesystemPlugin: Plugin = {
  name: 'filesystem',
  version: '1.0.0',
  tools: [{
    name: 'read_file',
    description: '读取文件内容',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    },
    execute: async (params) => {
      const fs = await import('fs/promises');
      return await fs.readFile(params.path, 'utf-8');
    }
  }]
};
```

### 命令处理器

```typescript
commands: [
  {
    name: 'echo',
    description: '回显消息',
    matcher: { type: 'regex', value: /^!echo\s+(.+)/ },
    handler: async (msg, args) => {
      msg.content = args[0];
      return msg;
    }
  }
]
```

支持匹配类型：`prefix`、`regex`、`exact`、`contains`

### 消息拦截

```typescript
async onMessage(msg) {
  msg.content = msg.content.replace(/敏感词/g, '***');
  return msg;
},

async onResponse(msg) {
  msg.content = '[Bot] ' + msg.content;
  return msg;
}
```

### Agent 钩子

```typescript
async onAgentBefore(msg, messages) {
  messages.unshift({ role: 'system', content: '你是个友好助手' });
},

async onAgentAfter(msg, response) {
  console.log('LLM 响应:', response.content);
}
```

### 工具拦截

```typescript
async onBeforeToolCall(toolName, params, context) {
  console.log(`调用工具: ${toolName}`, params);
  return params;
},

async onToolCall(toolName, params, result, context) {
  console.log(`工具结果: ${toolName}`, result);
  return result;
}
```

## 接口定义

### InboundMessage

```typescript
interface InboundMessage {
  channel: string;
  senderId: string;
  chatId: string;
  content: string;
  rawEvent?: any;
  timestamp: Date;
  messageId?: string;
  media?: string[];
  files?: InboundFile[];
  sessionKey?: string;
  messageType?: 'private' | 'group';
  intent?: ProcessingIntent;
  metadata?: Record<string, any>;
}
```

### OutboundMessage

```typescript
interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  reasoning_content?: string;
  replyTo?: string;
  media?: string[];
  metadata?: Record<string, any>;
  messageType?: 'private' | 'group';
}
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
  sendMessage(channel, chatId, content, messageType?): Promise<void>;
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

### callLLM

```typescript
const response = await context.agent.callLLM(
  [{ role: 'user', content: '你好' }],
  { allowTools: false }
);
```

## 配置

`config.yaml`：

```yaml
plugins:
  my-plugin:
    enabled: true
    options:
      apiKey: "${MY_API_KEY}"
```

## 目录结构

```
plugins/
├── my-plugin/
│   ├── main.js      # 入口文件
│   └── package.json # 依赖（可选）
```

## 最佳实践

1. 工具命名使用前缀，如 `filesystem_read`
2. execute 中捕获异常并返回有意义的错误
3. 使用 `context.logger` 记录日志
4. Hook 方法有 5 秒超时限制
5. 在 onUnload 中清理资源
6. 注意并发安全

## 错误处理

```typescript
async onError(error: Error, context: PluginErrorContext) {
  console.error('Plugin error:', error, context.type, context.data);
}
```
