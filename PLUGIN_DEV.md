# AesyClaw 插件开发指南

## 概述

AesyClaw 插件系统允许开发者扩展框架功能，包括：
- 注册自定义工具 (Tools)
- 添加消息中间件
- 拦截和处理入站/出站消息

## 插件结构

### 基本结构

```typescript
import type { Plugin, PluginContext, Tool } from 'aesyclaw';

const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: '我的第一个插件',
  
  // 生命周期钩子
  async onLoad(context: PluginContext) {
    console.log('插件加载');
  },
  
  async onStart() {
    console.log('插件启动');
  },
  
  async onStop() {
    console.log('插件停止');
  },
  
  async onUnload() {
    console.log('插件卸载');
  },
  
  // 消息处理
  async onMessage(msg) {
    return msg; // 返回处理后的消息
  },
  
  async onResponse(msg) {
    return msg;
  },
  
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
import type { Plugin, PluginContext, Tool } from 'aesyclaw';

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
  
  async onLoad(context: PluginContext) {
    const options = (this as any).options as MyPluginOptions;
    console.log('API Key:', options.apiKey);
    
    // 注册工具
    context.registerTool({
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
        // 使用配置
        const apiKey = (this as any).options.apiKey;
        // ... 执行逻辑
        return '结果';
      }
    });
  }
};

export default myPlugin;
```

### 3. 消息中间件

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

### 4. 消息拦截

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

### 5. 响应处理（生成图片等）

`onResponse` 可以在 AI 响应发送前对其进行修改，例如将 Markdown 渲染为图片：

```typescript
import type { Plugin, OutboundMessage } from 'aesyclaw';

const md2imgPlugin: Plugin = {
  name: 'md2img',
  version: '1.0.0',
  
  config: {
    minLength: 50,
    scale: 1.0
  },
  
  async onLoad(options) {
    this.config = {
      minLength: options?.minLength ?? 50,
      scale: Math.max(0.5, Math.min(3.0, options?.scale ?? 1.0))
    };
  },
  
  async onResponse(msg: OutboundMessage): Promise<OutboundMessage | null> {
    // 只处理足够长的消息
    if (!msg.content || msg.content.length < this.config.minLength) {
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
    // Markdown 检测逻辑
    return /^#{1,6}\s/m.test(text) || /^\*\*.*\*\*/m.test(text);
  },
  
  async renderToImage(markdown) {
    // 渲染实现...
  }
};

export default md2imgPlugin;
```

**OutboundMessage 接口**:
```typescript
interface OutboundMessage {
  channel: string;        // 渠道名称
  chatId: string;        // 聊天 ID
  content: string;        // 消息内容
  replyTo?: string;      // 回复消息 ID
  media?: string[];      // 媒体文件路径（如图片）
  metadata?: Record<string, any>;
  messageType?: 'private' | 'group';
}
```

## 工具定义

### Tool 接口

```typescript
interface Tool {
  name: string;           // 工具名称 (唯一标识)
  description: string;    // 工具描述 (供 AI 理解用途)
  parameters: object;    // JSON Schema 格式的参数定义
  validate?: (params: object) => string[];  // 参数验证
  execute: (params: object, context?: ToolContext) => Promise<string>;
}
```

### ToolContext

```typescript
interface ToolContext {
  workspace: string;      // 工作目录
  eventBus?: EventBus;   // 事件总线
  registerTool(tool: Tool): void;  // 注册工具
  getToolRegistry(): any;  // 获取工具注册表
}
```

### PluginContext (在 onLoad 中获取)

```typescript
interface PluginContext {
  config: Config;           // 当前配置
  eventBus: EventBus;       // 事件总线
  agent: AgentLoop;        // Agent 实例
  workspace: string;       // 工作目录
  registerTool(tool: Tool): void;  // 注册工具
  getToolRegistry(): any;  // 获取工具注册表
}
```

### 参数 Schema 示例

```typescript
parameters: {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      description: '要执行的命令'
    },
    timeout: {
      type: 'number',
      description: '超时时间(毫秒)',
      default: 30000
    }
  },
  required: ['command']
}
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

## 注册插件

### 方式 1: 通过配置文件

将插件文件放入 `plugins/` 目录：

```
plugins/
├── index.js          # 入口文件 (可选)
├── filesystem.js     # 文件系统插件
├── weather.js        # 天气插件
└── ...
```

### 方式 2: 手动注册

```typescript
import { PluginManager } from 'aesyclaw';

const pluginManager = new PluginManager(context, toolRegistry);

await pluginManager.loadPlugin({
  name: 'my-plugin',
  version: '1.0.0',
  tools: [...]
});
```

## 最佳实践

1. **工具命名**: 使用前缀区分不同插件的工具，如 `filesystem_read`, `weather_get`
2. **错误处理**: 在 execute 中捕获异常并返回有意义的错误消息
3. **参数验证**: 使用 validate 方法验证参数
4. **异步执行**: 工具执行应该是异步的，避免阻塞
5. **日志记录**: 使用 console.log 记录关键操作

## 完整配置示例

```yaml
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
