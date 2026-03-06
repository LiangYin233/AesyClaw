# 图片信息无法准确发送给 LLM 问题分析

**问题：** 用户发送的图片信息无法准确的发送给 LLM

**分析日期：** 2026-03-06

---

## 问题定位

通过代码审查，发现了图片信息处理流程中的**关键缺陷**：

### 🔴 核心问题：图片信息在发送给 LLM 时被丢弃

**问题位置：** `src/agent/AgentLoop.ts:65-106`

```typescript
// ContextBuilder.build() 方法
build(
  history: any[],
  currentMessage: string,  // ❌ 只接收文本内容
  channel?: string,
  chatId?: string
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: 'system', content: this.buildSystemPrompt() },
    ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
    { role: 'user', content: this.buildUserContent(currentMessage, channel, chatId) }
    // ❌ 没有处理 media 字段！
  ];
  return messages;
}
```

**问题说明：**
1. `ContextBuilder.build()` 方法只接收 `currentMessage: string` 参数
2. 没有接收或处理 `media` 字段
3. 构建的 LLMMessage 只包含文本内容，图片 URL 被完全忽略

---

## 完整流程分析

### 1. 图片接收阶段 ✅ 正常

**位置：** `src/channels/OneBotChannel.ts:318-322`

```typescript
case 'image':
  const file = data.file || '';
  const url = data.url || '';
  const imageUrl = url || `file://${file}`;
  return {
    text: url ? `[图片](${url})` : `[图片:${file}]`,  // 文本描述
    media: [imageUrl]  // ✅ 图片 URL 被正确提取
  };
```

**结果：**
- ✅ 图片 URL 被正确提取到 `media` 数组
- ✅ 文本中添加了 `[图片](url)` 标记

### 2. 消息解析阶段 ✅ 正常

**位置：** `src/channels/OneBotChannel.ts:281-306`

```typescript
private parseMessageWithMedia(message: any): { content: string; media?: string[] } {
  // ...
  const media = Array.from(mediaSet);
  return {
    content: content.trim(),
    media: media.length > 0 ? media : undefined  // ✅ media 被正确返回
  };
}
```

**结果：**
- ✅ `InboundMessage` 包含 `media` 字段
- ✅ 日志显示：`processMessage: content="...", media=["http://..."]`

### 3. 消息传递阶段 ✅ 正常

**位置：** `src/agent/AgentLoop.ts:198-205`

```typescript
private async processMessage(msg: InboundMessage): Promise<void> {
  // ...
  this.log.info(`processMessage: content="${msg.content}", media=${JSON.stringify(msg.media)}`);
  // ✅ msg.media 存在且有值
}
```

**结果：**
- ✅ `InboundMessage.media` 字段正常传递
- ✅ 日志确认 media 数组包含图片 URL

### 4. LLM 上下文构建阶段 ❌ **问题所在**

**位置：** `src/agent/AgentLoop.ts:65-106`

```typescript
// AgentLoop 调用 ContextBuilder
const messages = this.contextBuilder.build(
  session.messages,
  msg.content,  // ❌ 只传递了文本内容
  msg.channel,
  msg.chatId
);
// ❌ msg.media 没有被传递！

// ContextBuilder.build() 方法
build(
  history: any[],
  currentMessage: string,  // ❌ 只接收文本
  channel?: string,
  chatId?: string
): LLMMessage[] {
  // ❌ 没有 media 参数
  // ❌ 没有处理图片 URL
  // ❌ 只构建纯文本消息
}
```

**结果：**
- ❌ 图片 URL 被完全丢弃
- ❌ LLM 只收到 `[图片](url)` 文本标记，无法访问实际图片
- ❌ 多模态 LLM（如 GPT-4V）无法看到图片内容

---

## 问题影响

### 当前行为

1. 用户发送图片
2. OneBot 正确解析图片 URL
3. AgentLoop 收到包含 media 的消息
4. **ContextBuilder 丢弃 media 字段**
5. LLM 只收到文本 `[图片](url)`
6. LLM 无法看到或分析图片内容

### 用户体验

```
用户: [发送一张猫的图片] 这是什么动物？
系统内部: content="[图片](http://example.com/cat.jpg)", media=["http://example.com/cat.jpg"]
发送给 LLM: "这是什么动物？\n[图片](http://example.com/cat.jpg)"  ❌ 只有文本
LLM 回复: "抱歉，我无法看到图片内容。"  ❌ 无法识别
```

---

## 解决方案

### 方案 1：修改 ContextBuilder 支持多模态消息（推荐）

**修改文件：** `src/agent/AgentLoop.ts`

```typescript
// 1. 修改 ContextBuilder.build() 方法签名
build(
  history: any[],
  currentMessage: string,
  channel?: string,
  chatId?: string,
  media?: string[]  // ✅ 新增 media 参数
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: 'system', content: this.buildSystemPrompt() },
    ...history.filter(m => ['user', 'assistant', 'system'].includes(m.role)),
    {
      role: 'user',
      content: this.buildUserContent(currentMessage, channel, chatId, media)  // ✅ 传递 media
    }
  ];
  return messages;
}

// 2. 修改 buildUserContent() 方法
private buildUserContent(
  message: string,
  channel?: string,
  chatId?: string,
  media?: string[]  // ✅ 新增 media 参数
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  const ctx = [
    `[Runtime Context]`,
    channel && `Channel: ${channel}`,
    chatId && `Chat ID: ${chatId}`,
    `Time: ${new Date().toISOString()}`
  ].filter(Boolean).join('\\n');

  // ✅ 如果有图片，构建多模态消息
  if (media && media.length > 0) {
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: `${ctx}\\n\\n${message}` }
    ];

    // 添加图片
    for (const imageUrl of media) {
      content.push({
        type: 'image_url',
        image_url: { url: imageUrl }
      });
    }

    return content;
  }

  // 纯文本消息
  return `${ctx}\\n\\n${message}`;
}

// 3. 修改 AgentLoop 调用处
const messages = this.contextBuilder.build(
  session.messages,
  msg.content,
  msg.channel,
  msg.chatId,
  msg.media  // ✅ 传递 media 字段
);
```

**优点：**
- ✅ 完整支持多模态消息
- ✅ 符合 OpenAI Vision API 格式
- ✅ 支持多张图片
- ✅ 向后兼容（无图片时仍返回纯文本）

**缺点：**
- 需要修改 LLMMessage 类型定义
- 需要确保 LLM Provider 支持多模态

---

### 方案 2：在文本中嵌入图片 URL（临时方案）

**修改文件：** `src/agent/AgentLoop.ts`

```typescript
private buildUserContent(
  message: string,
  channel?: string,
  chatId?: string,
  media?: string[]  // ✅ 新增 media 参数
): string {
  const ctx = [
    `[Runtime Context]`,
    channel && `Channel: ${channel}`,
    chatId && `Chat ID: ${chatId}`,
    `Time: ${new Date().toISOString()}`
  ].filter(Boolean).join('\\n');

  // ✅ 如果有图片，在消息末尾添加图片 URL
  let fullMessage = `${ctx}\\n\\n${message}`;

  if (media && media.length > 0) {
    fullMessage += '\\n\\n[Images]:\\n' + media.map((url, i) => `${i + 1}. ${url}`).join('\\n');
  }

  return fullMessage;
}
```

**优点：**
- ✅ 实现简单
- ✅ 不需要修改类型定义
- ✅ 快速修复

**缺点：**
- ❌ LLM 仍然无法"看到"图片
- ❌ 只能通过 URL 推测内容
- ❌ 不支持真正的多模态

---

### 方案 3：修改 LLMMessage 类型支持多模态（完整方案）

**修改文件：** `src/types.ts`

```typescript
// 修改 LLMMessage 类型
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
      detail?: 'auto' | 'low' | 'high';
    };
  }>;
  name?: string;
}
```

**修改文件：** `src/providers/OpenAIProvider.ts`

```typescript
// 确保 Provider 正确处理多模态消息
async chat(
  messages: LLMMessage[],
  tools?: ToolDefinition[],
  model?: string
): Promise<LLMResponse> {
  // ✅ 直接传递 messages，OpenAI SDK 会自动处理多模态格式
  const response = await this.client.chat.completions.create({
    model: model || this.model,
    messages: messages,  // ✅ 支持 content 为数组
    tools: tools?.length ? tools : undefined,
    // ...
  });
  // ...
}
```

**优点：**
- ✅ 完整的多模态支持
- ✅ 符合 OpenAI 标准
- ✅ 支持图片细节控制（detail 参数）
- ✅ 易于扩展其他媒体类型

**缺点：**
- 需要修改多个文件
- 需要测试所有 Provider

---

## 推荐实施步骤

### 阶段 1：快速修复（1 小时）

1. 修改 `ContextBuilder.build()` 添加 `media` 参数
2. 修改 `buildUserContent()` 支持图片 URL
3. 修改 `AgentLoop` 调用处传递 `msg.media`
4. 测试基本功能

### 阶段 2：完整支持（2-3 小时）

1. 修改 `LLMMessage` 类型定义
2. 更新所有 Provider 实现
3. 添加图片下载和 base64 编码支持
4. 添加图片大小限制和格式验证
5. 完整测试

### 阶段 3：优化增强（可选）

1. 支持图片缓存
2. 支持图片压缩
3. 支持多种图片来源（URL、本地文件、base64）
4. 添加图片预处理（OCR、标签等）

---

## 相关代码位置

| 文件 | 行数 | 问题 |
|------|------|------|
| `src/agent/AgentLoop.ts` | 65-106 | ❌ ContextBuilder 不处理 media |
| `src/agent/AgentLoop.ts` | 198-205 | ✅ processMessage 接收 media |
| `src/channels/OneBotChannel.ts` | 318-322 | ✅ 正确解析图片 |
| `src/types.ts` | 1-12 | ✅ InboundMessage 包含 media |
| `src/types.ts` | 14-23 | ✅ OutboundMessage 包含 media |

---

## 测试建议

### 测试用例 1：单张图片

```
输入: [图片] 这是什么？
期望: LLM 能看到图片并回答
```

### 测试用例 2：多张图片

```
输入: [图片1] [图片2] 比较这两张图片
期望: LLM 能看到两张图片并比较
```

### 测试用例 3：图片 + 文本

```
输入: 看这张图 [图片] 里面有什么动物？
期望: LLM 能结合文本和图片回答
```

### 测试用例 4：无图片

```
输入: 你好
期望: 正常文本对话，不受影响
```

---

## 总结

**根本原因：** `ContextBuilder.build()` 方法在构建 LLM 消息时，只处理文本内容，完全忽略了 `media` 字段。

**影响范围：** 所有包含图片的消息都无法被 LLM 正确处理。

**修复优先级：** 🔴 **P0 - 严重**（核心功能缺失）

**预计工作量：**
- 快速修复：1 小时
- 完整支持：2-3 小时
- 测试验证：1 小时

**建议：** 优先实施方案 1（修改 ContextBuilder），然后逐步完善为方案 3（完整多模态支持）。
