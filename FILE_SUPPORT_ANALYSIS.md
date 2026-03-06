# 文件支持情况分析

**分析日期：** 2026-03-06
**问题：** 除了图片，其他文件类型是否支持发送给 LLM？

---

## 当前支持情况

### ✅ 已支持的媒体类型

根据 `src/channels/OneBotChannel.ts:318-340` 的代码分析：

| 类型 | OneBot 解析 | media 字段 | LLM 支持 | 状态 |
|------|-------------|-----------|----------|------|
| **image** | ✅ | ✅ | ✅ | **完全支持** |
| **video** | ✅ | ✅ | ⚠️ | **部分支持** |
| **file** | ✅ | ✅ | ⚠️ | **部分支持** |
| **record** (语音) | ✅ | ❌ | ❌ | **不支持** |

---

## 详细分析

### 1. 图片 (image) - ✅ 完全支持

**OneBot 解析：**
```typescript
case 'image':
  const file = data.file || '';
  const url = data.url || '';
  const imageUrl = url || `file://${file}`;
  return {
    text: url ? `[图片](${url})` : `[图片:${file}]`,
    media: [imageUrl]  // ✅ 添加到 media 数组
  };
```

**LLM 处理：**
- ✅ media 字段被传递给 ContextBuilder
- ✅ 构建多模态消息格式
- ✅ GPT-4V/GPT-4o 可以直接查看和分析图片

**支持的操作：**
- 图片识别
- OCR 文字提取
- 图片描述
- 图片对比

---

### 2. 视频 (video) - ⚠️ 部分支持

**OneBot 解析：**
```typescript
case 'video':
  return {
    text: `[视频]`,
    media: [data.file || data.url || '']  // ✅ 添加到 media 数组
  };
```

**当前状态：**
- ✅ 视频 URL 被提取到 `media` 字段
- ✅ 视频 URL 会被传递给 LLM
- ⚠️ **但 OpenAI API 不直接支持视频**

**实际效果：**
```
用户: [发送视频] 这个视频讲了什么？
系统: media=["http://example.com/video.mp4"]
LLM: 收到视频 URL，但无法直接播放或分析
LLM 回复: "抱歉，我无法直接查看视频内容。"
```

**限制：**
- OpenAI API 不支持视频输入
- 需要额外处理：提取视频帧 → 转为图片 → 发送给 LLM

---

### 3. 文件 (file) - ⚠️ 部分支持

**OneBot 解析：**
```typescript
case 'file':
  return {
    text: `[文件: ${data.file || ''}]`,
    media: [data.file || data.url || '']  // ✅ 添加到 media 数组
  };
```

**当前状态：**
- ✅ 文件 URL 被提取到 `media` 字段
- ✅ 文件 URL 会被传递给 LLM
- ⚠️ **但 OpenAI API 不直接支持文件**

**实际效果：**
```
用户: [发送 PDF 文件] 总结这个文档
系统: media=["http://example.com/document.pdf"]
LLM: 收到文件 URL，但无法直接读取
LLM 回复: "抱歉，我无法直接读取文件内容。"
```

**限制：**
- OpenAI API 不支持文档输入
- 需要额外处理：
  - PDF → 提取文本/图片
  - Word/Excel → 转换为文本
  - 代码文件 → 读取内容

---

### 4. 语音 (record) - ❌ 不支持

**OneBot 解析：**
```typescript
case 'record':
  return { text: `[语音]` };  // ❌ 没有 media 字段
```

**当前状态：**
- ❌ 语音 URL 未被提取
- ❌ 不会传递给 LLM

**实际效果：**
```
用户: [发送语音消息]
系统: content="[语音]", media=undefined
LLM: 只看到文本 "[语音]"
LLM 回复: "我看到你发送了语音消息，但我无法收听。"
```

---

## OpenAI API 支持情况

### ✅ 原生支持

| 类型 | API 支持 | 格式 |
|------|----------|------|
| **文本** | ✅ | `{ type: "text", text: "..." }` |
| **图片** | ✅ | `{ type: "image_url", image_url: { url: "..." } }` |

### ❌ 不支持（需要预处理）

| 类型 | 预处理方案 |
|------|-----------|
| **视频** | 提取关键帧 → 转为图片 |
| **音频** | 使用 Whisper API 转文字 |
| **PDF** | 提取文本 + 图片 |
| **Word/Excel** | 转换为文本 |
| **代码文件** | 直接读取内容 |

---

## 解决方案

### 方案 1：视频支持（推荐）

**实现步骤：**

1. **检测视频类型**
```typescript
if (media && media.some(url => url.match(/\.(mp4|avi|mov|webm)$/i))) {
  // 这是视频文件
}
```

2. **提取视频帧**
```typescript
import ffmpeg from 'fluent-ffmpeg';

async function extractVideoFrames(videoUrl: string): Promise<string[]> {
  // 每 N 秒提取一帧
  // 返回图片 URL 数组
}
```

3. **发送帧给 LLM**
```typescript
const frames = await extractVideoFrames(videoUrl);
// frames = ["frame1.jpg", "frame2.jpg", ...]
// 作为多张图片发送给 LLM
```

**优点：**
- ✅ 利用现有图片支持
- ✅ LLM 可以"看到"视频内容
- ✅ 支持视频分析

**缺点：**
- 需要 ffmpeg 依赖
- 处理时间较长
- 无法分析音频

---

### 方案 2：音频支持（推荐）

**实现步骤：**

1. **检测音频类型**
```typescript
case 'record':
  const audioUrl = data.file || data.url || '';
  return {
    text: `[语音]`,
    media: [audioUrl],  // ✅ 添加到 media
    mediaType: 'audio'  // 标记类型
  };
```

2. **使用 Whisper API 转文字**
```typescript
import OpenAI from 'openai';

async function transcribeAudio(audioUrl: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 下载音频文件
  const audioFile = await downloadFile(audioUrl);

  // 转录
  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: "whisper-1"
  });

  return transcription.text;
}
```

3. **将转录文本添加到消息**
```typescript
if (msg.media && msg.mediaType === 'audio') {
  const transcription = await transcribeAudio(msg.media[0]);
  msg.content += `\n\n[语音转文字]: ${transcription}`;
}
```

**优点：**
- ✅ 准确的语音识别
- ✅ 支持多语言
- ✅ LLM 可以理解语音内容

**缺点：**
- 需要额外 API 调用
- 增加延迟
- 额外费用

---

### 方案 3：文档支持

**实现步骤：**

1. **检测文档类型**
```typescript
if (media && media.some(url => url.match(/\.(pdf|docx|txt)$/i))) {
  // 这是文档文件
}
```

2. **提取文档内容**
```typescript
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

async function extractDocumentContent(fileUrl: string): Promise<string> {
  const fileType = fileUrl.split('.').pop()?.toLowerCase();

  switch (fileType) {
    case 'pdf':
      const pdfBuffer = await downloadFile(fileUrl);
      const pdfData = await pdf(pdfBuffer);
      return pdfData.text;

    case 'docx':
      const docxBuffer = await downloadFile(fileUrl);
      const result = await mammoth.extractRawText({ buffer: docxBuffer });
      return result.value;

    case 'txt':
      return await downloadFile(fileUrl).then(b => b.toString());

    default:
      return '';
  }
}
```

3. **将内容添加到消息**
```typescript
if (msg.media && isDocument(msg.media[0])) {
  const content = await extractDocumentContent(msg.media[0]);
  msg.content += `\n\n[文档内容]:\n${content}`;
}
```

**优点：**
- ✅ LLM 可以分析文档内容
- ✅ 支持多种格式
- ✅ 无需额外 API

**缺点：**
- 需要多个依赖库
- 大文档可能超出 token 限制
- 无法处理图片型 PDF

---

## 推荐实施优先级

### P0 - 立即实施（已完成）
- ✅ **图片支持** - 已完成

### P1 - 短期实施（1-2 周）
1. **音频转文字** - 使用 Whisper API
   - 预计工作量：4-6 小时
   - 用户需求高
   - 实现相对简单

2. **文本文档支持** - PDF/TXT/DOCX
   - 预计工作量：6-8 小时
   - 实用性强
   - 技术成熟

### P2 - 中期实施（1-2 月）
3. **视频帧提取** - 关键帧分析
   - 预计工作量：8-12 小时
   - 需要 ffmpeg
   - 处理复杂

---

## 快速修复建议

如果需要快速支持音频，可以先修改 OneBotChannel：

```typescript
// src/channels/OneBotChannel.ts
case 'record':
  const audioUrl = data.file || data.url || '';
  return {
    text: `[语音]`,
    media: audioUrl ? [audioUrl] : undefined  // ✅ 添加音频 URL
  };
```

然后在 AgentLoop 中添加音频处理：

```typescript
// src/agent/AgentLoop.ts
if (msg.media && msg.media.some(url => url.match(/\.(mp3|wav|ogg|m4a)$/i))) {
  // 检测到音频文件
  this.log.info('Audio file detected, transcribing...');

  try {
    const transcription = await this.transcribeAudio(msg.media[0]);
    msg.content += `\n\n[语音转文字]: ${transcription}`;
    this.log.info(`Transcription: ${transcription}`);
  } catch (error) {
    this.log.error('Failed to transcribe audio:', error);
  }
}
```

---

## 总结

**当前状态：**
- ✅ **图片** - 完全支持
- ⚠️ **视频** - URL 传递但 LLM 无法处理
- ⚠️ **文件** - URL 传递但 LLM 无法处理
- ❌ **语音** - 未提取 URL

**建议：**
1. 优先实施音频转文字（P1）
2. 然后支持文本文档（P1）
3. 最后考虑视频帧提取（P2）

**需要的依赖：**
- 音频：OpenAI Whisper API
- 文档：`pdf-parse`, `mammoth`
- 视频：`fluent-ffmpeg`
