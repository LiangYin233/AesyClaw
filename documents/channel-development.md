# 频道开发指南

## 概述

频道插件连接外部消息平台（QQ、Telegram、WebSocket 等），实现消息的收发与路由。频道存放在 `extensions/channel_*` 目录，需要实现 `ChannelPlugin` 接口。

所有公共 API 通过 `@aesyclaw/sdk` 导入。

---

## 快速开始

创建 `extensions/channel_myplatform/` 目录，包含 `index.ts` 和可选的 `package.json`：

```ts
// extensions/channel_myplatform/index.ts
import type { ChannelPlugin, ChannelContext, OutboundSignal } from '@aesyclaw/sdk';

export const channel: ChannelPlugin = {
  name: 'myplatform',
  version: '0.1.0',
  description: 'My custom messaging platform',
  streaming: false, // 是否支持流式输出
  defaultConfig: {
    enabled: true,
    apiKey: '',
  },

  async init(ctx: ChannelContext) {
    // 连接消息平台，收到消息时调用：
    // ctx.receive(message, sessionKey, sender)
  },

  async destroy() {
    // 断开连接，清理资源
  },

  async receive(message, sessionKey, sender) {
    // 入站消息处理（可选，通常通过 ctx.receive 直接透传）
  },

  async send(signal: OutboundSignal) {
    // 处理出站信号
  },
};

export default channel;
```

---

## ChannelPlugin

| 字段                                    | 类型      | 必填 | 说明                           |
| --------------------------------------- | --------- | ---- | ------------------------------ |
| `name`                                  | `string`  | ✅   | 频道名称                       |
| `version`                               | `string`  | ✅   | 语义化版本号                   |
| `description`                           | `string`  | ❌   | 频道简介                       |
| `streaming`                             | `boolean` | ✅   | 是否支持流式输出（见下方说明） |
| `defaultConfig`                         | `object`  | ❌   | 默认配置                       |
| `init(ctx)`                             | `async`   | ✅   | 频道初始化                     |
| `destroy()`                             | `async`   | ❌   | 频道卸载                       |
| `receive(message, sessionKey, sender?)` | `async`   | ✅   | 接收入站消息                   |
| `send(signal)`                          | `async`   | ✅   | 接收出站信号                   |

---

## 流式输出（streaming）

`streaming` 决定频道如何处理 LLM 的流式回复：

| streaming | chunk 信号          | done 信号                                                                             | 说明                               |
| --------- | ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| `true`    | 直接转发给频道      | 直接转发给频道                                                                        | 频道自己处理逐帧渲染（如 Desktop） |
| `false`   | ChannelManager 缓存 | ChannelManager 拦截，组装完整消息后运行 `pipeline:send` 钩子，转为 `message` 信号发送 | 频道只收到最终消息（如 OneBot）    |

**选择建议：**

- 如果客户端支持实时流式显示（如 WebSocket 推送），设 `streaming: true`
- 如果客户端只支持一次发送完整消息（如 QQ 消息），设 `streaming: false`

`streaming: false` 时，ChannelManager 会自动将 `[Attachments]` 等富文本经过 md2img 等插件处理后发送，频道无需关心内容渲染。

---

## ChannelContext

频道在 `init(ctx)` 中接收的上下文：

| 属性/方法                               | 说明                                 |
| --------------------------------------- | ------------------------------------ |
| `name`                                  | 频道名称                             |
| `config`                                | 频道配置                             |
| `configManager`                         | 全局配置管理器                       |
| `paths`                                 | 路径解析器                           |
| `receive(message, sessionKey, sender?)` | 将入站消息送入 Pipeline 处理         |
| `registerTool(tool)`                    | 注册工具（作用域 `channel:{name}`）  |
| `registerCommand(cmd)`                  | 注册斜杠命令                         |
| `getCommands()`                         | 获取已注册的命令列表（不含 execute） |
| `logger`                                | 带 `channel:{name}` 作用域的 Logger  |

---

## 出站信号类型

频道的 `send(signal)` 方法接收以下信号：

### `chunk` — 流式文本块

```ts
{ kind: 'chunk', session: SessionKey, text: string, index: number }
```

仅 `streaming: true` 的频道会收到此信号。

### `message` — 完整消息

```ts
{ kind: 'message', session: SessionKey, content: Message, intermediate?: boolean }
```

所有频道都会收到。`intermediate: true` 表示 send_msg 等中间消息，`false` 表示最终回复。

### `done` — 流式结束

```ts
{ kind: 'done', session: SessionKey, usage?: MessageUsage }
```

仅 `streaming: true` 的频道会收到。`streaming: false` 的频道在 done 时收到的是被 ChannelManager 处理过的 `message` 信号。

### 其他信号

```ts
{ kind: 'toolCall', ... }    // 工具调用开始（频道理应忽略）
{ kind: 'toolResult', ... }  // 工具调用结果（频道理应忽略）
{ kind: 'error', ... }       // 处理错误
```

---

## 入站消息处理

当频道收到外部消息时，构造 `Message` 并通过 `ctx.receive()` 送入 Pipeline：

```ts
ctx.receive(
  { components: [{ type: 'Plain', text: '用户消息' }] },
  { channel: 'myplatform', type: 'private', chatId: 'user-123' },
  { id: 'user-123', name: '用户名' },
);
```

`sessionKey` 格式：

| 字段      | 说明                              |
| --------- | --------------------------------- |
| `channel` | 频道名称，与 `enum` 定义一致      |
| `type`    | `'private'` 私聊 / `'group'` 群聊 |
| `chatId`  | 用户 ID 或群 ID                   |

---

## 已有频道参考

| 频道              | streaming | 技术要点                               |
| ----------------- | --------- | -------------------------------------- |
| `channel_desktop` | `true`    | WebSocket 双向通信，流式转发           |
| `channel_onebot`  | `false`   | OneBot/NapCat 协议，文件上传，附件下载 |

详见 `extensions/` 目录下的源码。
