# Channel 开发指南

本文档描述如何开发和维护 AesyClaw 的 Channel 适配器，确保不同 Channel 之间的一致性。

## 架构概述

AesyClaw 的 Channel 架构采用**模板方法模式**，通过 `BaseChannel` 提供标准化的消息处理流水线，子类只需实现平台特定的细节。

### 核心组件

1. **BaseChannel**：抽象基类，定义标准化的消息处理中间件
2. **MessageParser**：工具模块，提供消息解析的通用函数
3. **具体 Channel**：实现特定平台的连接和消息格式转换

### 消息处理流水线

**入站消息（Inbound）**：
```
平台事件 → parseMessage() → processInboundMessage() → downloadFiles() → publishInbound() → EventBus
```

**出站消息（Outbound）**：
```
EventBus → validateMessage() → send() → 平台 API
```

## 核心原则

1. **使用标准化流水线**：调用 `processInboundMessage()` 而不是手动处理每个步骤
2. **实现 parseMessage()**：将平台消息格式转换为 `ParsedMessage`
3. **使用 MessageHandlers**：使用 `MessageParser` 提供的工具函数处理常见消息类型
4. **类型标记**：特殊文件类型（音频、视频）必须在 `files` 数组中标记 `type` 字段
5. **保留原始数据**：将原始事件保存在 `rawEvent` 字段中，供高级插件使用

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

  // 实现抽象方法
  async start(): Promise<void> { /* 连接到平台 */ }
  async stop(): Promise<void> { /* 断开连接 */ }
  async send(msg: OutboundMessage): Promise<void> { /* 发送消息 */ }

  // 实现消息解析
  protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
    // 将平台消息转换为标准格式
  }
}
```

### 2. 实现 parseMessage()

这是**唯一必须实现**的平台特定方法：

```typescript
protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
  const messageType = rawEvent.type;
  const data = rawEvent.data;

  switch (messageType) {
    case 'text':
      return MessageHandlers.text(data.text);

    case 'image':
      return MessageHandlers.image(data.url);

    case 'audio':
      return MessageHandlers.audio(data.url, data.filename);

    case 'video':
      return MessageHandlers.video(data.url, data.filename);

    default:
      return MessageHandlers.unknown(messageType);
  }
}
```

### 3. 处理入站消息

在接收到平台事件后，调用标准化流水线：

```typescript
private async handlePlatformEvent(event: any): Promise<void> {
  const senderId = event.sender.id;
  const chatId = event.chat.id;
  const messageType = event.chat.type === 'private' ? 'private' : 'group';
  const messageId = event.message.id;

  // 使用标准化流水线（自动处理权限、解析、下载、发布）
  await this.processInboundMessage(
    senderId,
    chatId,
    messageType,
    event,
    messageId
  );
}
```

### 4. 实现消息发送

```typescript
async send(msg: OutboundMessage): Promise<void> {
  // 验证消息
  if (!this.validateMessage(msg)) {
    return;
  }

  // 格式化并发送到平台
  await this.platformAPI.sendMessage({
    chatId: msg.chatId,
    content: msg.content,
    // ... 其他字段
  });
}
```

### 5. 特殊需求：自定义文件下载

如果平台需要特殊的认证头，可以重写 `downloadFiles()`：

```typescript
protected async downloadFiles(files: InboundFile[]): Promise<InboundFile[]> {
  const token = await this.getAuthToken();
  return super.downloadFiles(files, {
    'Authorization': `Bearer ${token}`
  });
}
```

## BaseChannel 提供的方法

### 模板方法（子类调用）

- `processInboundMessage()` - 标准化的入站消息处理流水线
- `downloadFiles()` - 下载文件到本地
- `publishInbound()` - 发布消息到 EventBus

### 工具方法

- `isAllowed()` - 检查发送者权限
- `validateMessage()` - 验证出站消息
- `isRunning()` - 检查 Channel 运行状态

### 抽象方法（子类必须实现）

- `start()` - 启动 Channel
- `stop()` - 停止 Channel
- `send()` - 发送消息
- `parseMessage()` - 解析平台消息格式

## 数据结构

```typescript
export interface InboundMessage {
  channel: string;           // Channel 名称
  senderId: string;          // 发送者 ID
  chatId: string;            // 会话 ID
  content: string;           // 文本内容（可包含占位符如 [语音]）
  rawEvent?: any;            // 原始事件数据
  timestamp: Date;           // 时间戳
  messageId?: string;        // 消息 ID
  media?: string[];          // 图片 URL 数组
  files?: InboundFile[];     // 文件数组（音频、视频、文档等）
  sessionKey?: string;       // 会话密钥
  messageType?: 'private' | 'group';  // 消息类型
  skipLLM?: boolean;         // 是否跳过 LLM 处理（由插件设置）
  metadata?: Record<string, any>;     // 额外元数据
}

export interface InboundFile {
  name: string;              // 文件名
  url: string;               // 文件 URL
  localPath?: string;        // 本地路径（下载后）
  type?: 'audio' | 'video' | 'file' | 'image';  // 文件类型
}
```

## MessageParser 工具函数

`MessageParser` 模块提供了标准化的消息处理工具，确保所有 Channel 以一致的方式处理消息。

### 导入

```typescript
import { MessageHandlers, createFile, detectFileType } from './MessageParser.js';
```

### MessageHandlers

预定义的消息类型处理器：

```typescript
// 文本消息
MessageHandlers.text(text: string)
// 返回: { text: string }

// 图片消息
MessageHandlers.image(url: string, placeholder?: string)
// 返回: { text: string, media: string[] }

// 语音消息
MessageHandlers.audio(url: string, name?: string)
// 返回: { text: '[语音]', files: InboundFile[] }

// 视频消息
MessageHandlers.video(url: string, name?: string)
// 返回: { text: '[视频: name]', files: InboundFile[] }

// 文件消息
MessageHandlers.file(url: string, name: string)
// 返回: { text: '[文件: name]', files: InboundFile[] }

// @提及消息
MessageHandlers.at(userId: string, isAll?: boolean)
// 返回: { text: '@用户' 或 '@全体成员' }

// 未知类型
MessageHandlers.unknown(type: string)
// 返回: { text: '[type]' }
```

### 工具函数

```typescript
// 检测文件类型
detectFileType(fileName: string): 'audio' | 'video' | 'image' | 'file'

// 创建标准化文件对象
createFile(name: string, url: string, type?: 'audio' | 'video' | 'image' | 'file'): InboundFile
```

### 使用示例

参考 OneBotChannel 和 FeishuChannel 的实现。

## 实际案例

### OneBotChannel 示例

```typescript
// 1. 接收平台事件
private async handleMessageEvent(payload: any): Promise<void> {
  const senderId = payload.user_id?.toString();
  const chatId = payload.message_type === 'private'
    ? payload.user_id?.toString()
    : payload.group_id?.toString();
  const messageType = payload.message_type;
  const messageId = payload.message_id?.toString();

  // 2. 调用标准化流水线
  await this.processInboundMessage(senderId, chatId, messageType, payload, messageId);
}

// 3. 实现 parseMessage
protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
  return this.parseMessageWithMedia(rawEvent.message);
}

// 4. 平台特定的消息解析逻辑
private parseMessageWithMedia(message: any): ParsedMessage {
  // ... 使用 MessageHandlers 解析各种消息类型
  const handlers = {
    text: () => MessageHandlers.text(data.text),
    image: () => MessageHandlers.image(url),
    record: () => MessageHandlers.audio(url),
    // ...
  };
}
```

### FeishuChannel 示例

```typescript
// 1. 接收平台事件
private async handleMessageEvent(event: any): Promise<void> {
  const sender = event.sender?.sender_id?.open_id;
  const chatId = event.message.chat_type === 'p2p' ? sender : event.message.chat_id;
  const messageType = event.message.chat_type === 'p2p' ? 'private' : 'group';

  // 存储当前消息供 parseMessage 使用
  this.currentMessage = {
    type: event.message.message_type,
    content: event.message.content
  };

  // 2. 调用标准化流水线
  await this.processInboundMessage(sender, chatId, messageType, event, event.message.message_id);
}

// 3. 实现 parseMessage
protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
  return await this.parseMessageContent(
    this.currentMessage.type,
    this.currentMessage.content
  );
}

// 4. 重写 downloadFiles 添加认证
protected async downloadFiles(files: InboundFile[]): Promise<InboundFile[]> {
  const token = await this.getValidToken();
  return super.downloadFiles(files, {
    'Authorization': `Bearer ${token}`
  });
}
```

## 插件开发规范

### 处理特定文件类型

插件应该优先使用标准化的 `files` 数组：

```javascript
// ✅ 推荐：使用标准化字段
async onMessage(msg) {
  const audioFile = msg.files?.find(f => f.type === 'audio');
  if (audioFile) {
    const audioUrl = audioFile.url;
    // 处理音频...
  }

  if (!audioFile && msg.content === '[语音]') {
    return {
      ...msg,
      content: '[语音消息 - 无法处理]',
      skipLLM: true
    };
  }

  return msg;
}

// ❌ 不推荐：直接解析 rawEvent
async onMessage(msg) {
  const voiceSegment = msg.rawEvent?.message?.find(seg => seg.type === 'record');
  // 这种方式依赖特定 Channel 的数据结构
}
```

### skipLLM 标志使用

- **插件修改消息但希望 LLM 继续处理**：不设置 `skipLLM`
  - 例如：speech_to_text 转录后的文本

- **插件直接回复用户，跳过 LLM**：设置 `skipLLM: true`
  - 例如：转录失败的错误提示
  - 例如：after_file_reply 已经调用 LLM 后的回复

## 测试清单

开发新 Channel 时，确保通过以下测试：

- [ ] 文本消息正常收发
- [ ] 图片消息正确解析到 `media` 数组
- [ ] 语音消息正确解析到 `files` 数组，且 `type: 'audio'`
- [ ] 视频消息正确解析到 `files` 数组，且 `type: 'video'`
- [ ] 文件消息正确解析到 `files` 数组，且 `type: 'file'`
- [ ] `rawEvent` 保留完整原始数据
- [ ] 权限控制（friendAllowFrom、groupAllowFrom）正常工作
- [ ] 文件下载功能正常（如果平台支持）
- [ ] 消息发送验证（空消息被拒绝）

## 常见问题

### Q: 为什么要使用 processInboundMessage() 而不是手动处理？

A: `processInboundMessage()` 提供标准化的处理流水线，包括：
- 权限检查
- 消息解析
- 文件下载
- 发布到 EventBus

这确保所有 Channel 的行为一致，减少重复代码，降低维护成本。

### Q: 什么时候需要重写 downloadFiles()？

A: 当平台需要特殊的认证头时（如 Bearer token）。大多数情况下使用默认实现即可。

### Q: 如何处理平台特有的消息类型？

A:
1. 如果是通用类型（如位置、联系人），考虑扩展 `InboundFile.type`
2. 如果是平台特有类型，放入 `metadata` 字段
3. 在 `content` 中添加占位符，让 LLM 知道这是什么类型的消息

### Q: parseMessage() 可以是异步的吗？

A: 可以。`parseMessage()` 返回 `Promise<ParsedMessage>`，支持异步操作（如获取资源 URL）。

## 架构优势

1. **一致性**：所有 Channel 遵循相同的处理流程
2. **可维护性**：通用逻辑集中在 BaseChannel，减少重复代码
3. **可扩展性**：新 Channel 只需实现平台特定的部分
4. **可测试性**：标准化接口便于单元测试
5. **向后兼容**：现有插件无需修改即可工作

## 版本历史

- v2.0.0 (2026-03-08): 引入模板方法模式，标准化消息处理流水线
- v1.0.0 (2026-03-08): 初始版本，标准化语音消息处理
