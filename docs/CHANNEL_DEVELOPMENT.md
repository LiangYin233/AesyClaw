# Channel 开发指南

本文档描述如何开发和维护 AesyClaw 的 Channel 适配器，确保不同 Channel 之间的一致性。

## 核心原则

1. **标准化消息格式**：所有 Channel 必须将平台特定的消息格式转换为统一的 `InboundMessage` 格式
2. **使用工具函数**：使用 `MessageParser` 提供的工具函数处理常见消息类型
3. **类型标记**：特殊文件类型（音频、视频）必须在 `files` 数组中标记 `type` 字段
4. **保留原始数据**：将原始事件保存在 `rawEvent` 字段中，供高级插件使用
5. **插件优先**：Channel 只负责解析和转换，具体处理逻辑由插件完成

## InboundMessage 结构

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

```typescript
// OneBot Channel 示例
private parseMessageSegment(seg: any): ParsedSegment {
  const type = seg.type;
  const data = seg.data || {};

  const handlers: Record<string, () => ParsedSegment> = {
    text: () => MessageHandlers.text(data.text || ''),
    image: () => {
      const url = data.url || '';
      return MessageHandlers.image(url, `[图片](${url})`);
    },
    record: () => {
      const url = data.url || data.file || '';
      return url ? MessageHandlers.audio(url) : { text: '[语音]' };
    },
    video: () => {
      const name = data.file || 'video';
      const url = data.url || '';
      return url ? MessageHandlers.video(url, name) : { text: `[视频: ${name}]` };
    },
    file: () => {
      const name = data.file || 'file';
      const url = data.url || '';
      return url ? MessageHandlers.file(url, name) : { text: `[文件: ${name}]` };
    }
  };

  const handler = handlers[type];
  return handler ? handler() : MessageHandlers.unknown(type);
}
```

## 消息类型处理规范（已废弃）

**注意**：以下手动处理方式已被 `MessageHandlers` 取代，新代码应使用上述工具函数。

### 1. 文本消息
```typescript
{ text: data.text || '' }
```

### 2. 图片消息
```typescript
{
  text: `[图片](${url})`,  // 可选：在 content 中添加占位符
  media: [imageUrl]         // 必须：图片 URL 放入 media 数组
}
```

### 3. 语音消息（重要）
```typescript
{
  text: '[语音]',           // 必须：占位符，让用户知道这是语音
  files: [{
    name: 'voice.amr',      // 文件名（可根据实际格式调整）
    url: audioUrl,          // 必须：音频 URL
    type: 'audio'           // 必须：标记为 audio 类型
  }]
}
```

**为什么这样设计？**
- `text: '[语音]'`：让 LLM 知道这是语音消息（如果插件未处理）
- `files` 数组：提供标准化的音频 URL，插件可以直接使用
- `type: 'audio'`：插件通过类型快速识别，无需解析文件扩展名或 rawEvent

### 4. 视频消息
```typescript
{
  text: `[视频: ${name}]`,
  files: [{
    name: fileName,
    url: videoUrl,
    type: 'video'           // 必须：标记为 video 类型
  }]
}
```

### 5. 文件消息
```typescript
{
  text: `[文件: ${name}]`,
  files: [{
    name: fileName,
    url: fileUrl,
    type: 'file'            // 必须：标记为 file 类型
  }]
}
```

## 插件开发规范

### 处理特定文件类型

插件应该优先使用标准化的 `files` 数组，而不是深入 `rawEvent`：

```javascript
// ✅ 推荐：使用标准化字段
async onMessage(msg) {
  // 查找音频文件
  const audioFile = msg.files?.find(f => f.type === 'audio');
  if (audioFile) {
    const audioUrl = audioFile.url;
    // 处理音频...
  }

  // 如果没有找到，检查是否是占位符
  if (!audioFile && msg.content === '[语音]') {
    return {
      ...msg,
      content: '[语音消息 - 无法处理]',
      skipLLM: true
    };
  }

  return msg;
}

// ❌ 不推荐：直接解析 rawEvent（耦合度高）
async onMessage(msg) {
  const voiceSegment = msg.rawEvent?.message?.find(seg => seg.type === 'record');
  // 这种方式依赖特定 Channel 的数据结构
}
```

### skipLLM 标志使用

- **插件修改消息但希望 LLM 继续处理**：不设置 `skipLLM`（默认 false）
  - 例如：speech_to_text 转录后的文本

- **插件直接回复用户，跳过 LLM**：设置 `skipLLM: true`
  - 例如：转录失败的错误提示
  - 例如：after_file_reply 已经调用 LLM 后的回复

## 添加新 Channel 的步骤

### 1. 创建 Channel 类

```typescript
import { BaseChannel } from './BaseChannel.js';
import type { OutboundMessage, InboundFile } from '../types.js';

export class MyChannel extends BaseChannel {
  readonly name = 'mychannel';

  async start(): Promise<void> {
    // 启动逻辑
  }

  async stop(): Promise<void> {
    // 停止逻辑
  }

  async send(msg: OutboundMessage): Promise<void> {
    // 发送消息逻辑
  }

  private parseMessage(rawMessage: any): {
    content: string;
    media?: string[];
    files?: InboundFile[];
  } {
    // 解析消息，遵循上述规范
  }
}
```

### 2. 注册 Channel

```typescript
static register(): void {
  const plugin: ChannelPlugin = {
    name: 'mychannel',
    create: (config, eventBus, workspace) =>
      new MyChannel(config, eventBus, workspace)
  };
  ChannelManager.registerPlugin(plugin);
}
```

### 3. 测试清单

- [ ] 文本消息正常收发
- [ ] 图片消息正确解析到 `media` 数组
- [ ] 语音消息正确解析到 `files` 数组，且 `type: 'audio'`
- [ ] 视频消息正确解析到 `files` 数组，且 `type: 'video'`
- [ ] 文件消息正确解析到 `files` 数组，且 `type: 'file'`
- [ ] `rawEvent` 保留完整原始数据
- [ ] 权限控制（friendAllowFrom、groupAllowFrom）正常工作

## 常见问题

### Q: 为什么语音消息要同时设置 `text: '[语音]'` 和 `files` 数组？

A:
- `text: '[语音]'`：如果插件未启用或处理失败，LLM 会看到这个占位符，可以友好地提示用户
- `files` 数组：提供标准化的音频 URL，插件可以直接处理，无需解析 rawEvent

### Q: 什么时候使用 `rawEvent`？

A:
- Channel 开发：总是保存完整的 `rawEvent`
- 插件开发：优先使用标准化字段（`files`、`media`），只在需要平台特定功能时使用 `rawEvent`

### Q: 如何处理平台特有的消息类型？

A:
1. 如果是通用类型（如位置、联系人），考虑扩展 `InboundFile.type`
2. 如果是平台特有类型，放入 `metadata` 字段
3. 在 `content` 中添加占位符，让 LLM 知道这是什么类型的消息

## 版本历史

- v1.0.0 (2026-03-08): 初始版本，标准化语音消息处理
