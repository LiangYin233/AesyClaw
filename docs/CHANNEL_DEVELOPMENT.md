# Channel 开发指南

## 架构

采用**模板方法模式**，通过 `BaseChannel` 提供标准化消息处理流水线。

### 核心组件

1. **BaseChannel**：抽象基类，定义消息处理中间件
2. **MessageParser**：消息解析工具
3. **具体 Channel**：实现平台特定的连接和格式转换

### 消息流水线

**入站**：`平台事件 → parseMessage() → processInboundMessage() → downloadFiles() → publishInbound()`

**出站**：`EventBus → validateMessage() → send() → 平台 API`

## 核心原则

1. 使用 `processInboundMessage()` 标准化流水线
2. 实现 `parseMessage()` 转换平台消息为 `ParsedMessage`
3. 使用 `MessageHandlers` 处理常见消息类型
4. 文件类型（音频、视频）标记 `type` 字段
5. 保留 `rawEvent` 原始数据

## 开发新 Channel

### 1. 继承 BaseChannel

```typescript
import { BaseChannel, type ParsedMessage } from './BaseChannel.js';
import { MessageHandlers } from './MessageParser.js';

export class MyChannel extends BaseChannel {
  readonly name = 'my-channel';

  constructor(config: MyConfig, eventBus: EventBus, workspace?: string) {
    super(config, eventBus, workspace);
    this.log = logger.child({ prefix: 'MyChannel' });
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async send(msg: OutboundMessage): Promise<void> {}

  protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
    // 转换平台消息为标准格式
  }
}
```

### 2. 实现 parseMessage()

```typescript
protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
  switch (rawEvent.type) {
    case 'text':
      return MessageHandlers.text(rawEvent.data.text);
    case 'image':
      return MessageHandlers.image(rawEvent.data.url);
    case 'audio':
      return MessageHandlers.audio(rawEvent.data.url);
    case 'video':
      return MessageHandlers.video(rawEvent.data.url);
    default:
      return MessageHandlers.unknown(rawEvent.type);
  }
}
```

### 3. 处理入站消息

```typescript
private async handlePlatformEvent(event: any): Promise<void> {
  const senderId = event.sender.id;
  const chatId = event.chat.id;
  const messageType = event.chat.type === 'private' ? 'private' : 'group';

  await this.processInboundMessage(
    senderId, chatId, messageType, event, event.message.id
  );
}
```

### 4. 实现发送

```typescript
async send(msg: OutboundMessage): Promise<void> {
  if (!this.validateMessage(msg)) return;
  await this.platformAPI.send({ chatId: msg.chatId, content: msg.content });
}
```

### 5. 自定义文件下载

```typescript
protected async downloadFiles(files: InboundFile[]): Promise<InboundFile[]> {
  const token = await this.getAuthToken();
  return super.downloadFiles(files, { 'Authorization': `Bearer ${token}` });
}
```

## BaseChannel 方法

### 子类调用

- `processInboundMessage()` - 入站流水线
- `downloadFiles()` - 下载文件
- `publishInbound()` - 发布到 EventBus

### 工具方法

- `isAllowed()` - 检查权限
- `validateMessage()` - 验证消息
- `isRunning()` - 运行状态

### 抽象方法（必须实现）

- `start()` - 启动
- `stop()` - 停止
- `send()` - 发送
- `parseMessage()` - 解析

## 数据结构

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

interface InboundFile {
  name: string;
  url: string;
  localPath?: string;
  type?: 'audio' | 'video' | 'file' | 'image';
}
```

## MessageHandlers

```typescript
// 文本
MessageHandlers.text(text)

// 图片
MessageHandlers.image(url, placeholder?)
MessageHandlers.audio(url, name?)
MessageHandlers.video(url, name?)
MessageHandlers.file(url, name)
MessageHandlers.at(userId, isAll?)
MessageHandlers.unknown(type)
```

工具函数：
- `detectFileType(fileName)` - 检测文件类型
- `createFile(name, url, type?)` - 创建文件对象

## 测试清单

- [ ] 文本消息收发
- [ ] 图片解析到 `media`
- [ ] 语音解析到 `files`，`type: 'audio'`
- [ ] 视频解析到 `files`，`type: 'video'`
- [ ] 文件解析到 `files`，`type: 'file'`
- [ ] `rawEvent` 保留原始数据
- [ ] 权限控制正常
- [ ] 文件下载正常
- [ ] 消息发送验证

## 常见问题

### Q: 为什么要用 processInboundMessage()？

A: 提供标准化流水线：权限检查 → 解析 → 下载 → 发布，确保一致性。

### Q: 何时重写 downloadFiles()？

A: 平台需要特殊认证头时（如 Bearer token）。

### Q: parseMessage() 可以异步吗？

A: 可以，返回 `Promise<ParsedMessage>`。
