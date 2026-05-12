<p align="center">
  <img src="./assets/groupLogo.svg" alt="AesyClaw" width="400" />
</p>

<p align="center"><em>AesyClaw: A lightweight, high-performance, and scalable Agent, tailored just as you prefer.</em></p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22.13-339933?logo=node.js&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/yarn-4.14-2C8EBB?logo=yarn&logoColor=white" alt="Yarn" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
</p>

---

AesyClaw 是一个可扩展的 AI Agent 运行时平台。它通过统一的 Pipeline 编排多模型调用、工具执行和消息路由，让你可以在 QQ、HTTP 等多通道上运行自定义 AI Agent。支持插件扩展、MCP 协议集成、技能系统、定时任务和 Web 仪表盘管理，开箱即用地构建属于自己的 AI 助手。

## 核心特性

- 🧠 多模型支持 — 兼容 OpenAI / Anthropic 等多 LLM 提供商，统一 API 抽象
- 🔌 插件系统 — Hooks 生命周期钩子，轻松扩展 Agent 行为
- 🔧 MCP 集成 — 接入外部工具服务器，自动注册工具
- 💬 多通道消息 — 支持 OneBot (QQ) 和自定义消息通道
- 📋 技能系统 — Markdown 定义的 AI 行为模板
- 🔀 子代理支持 — 角色隔离的子代理，独立工具与技能权限
- ⏰ 定时任务 — Cron 驱动的自动化 Agent 任务
- 🖥️ Web 仪表盘 — 实时监控会话、用量、角色配置

## 快速开始

### 前置要求

- Node.js >= 22.13
- Yarn 4.14+

### 安装与启动

```bash
yarn install    # 安装依赖
yarn dev        # 开发模式（热加载）
yarn start      # 生产模式（含 Web UI 构建）
yarn build      # 构建 Web UI
yarn test       # 运行测试
```

### 首次配置

启动后会在 `.aesyclaw/` 目录生成默认配置文件，编辑 `config.json` 填入 LLM API 密钥即可使用。

## 配置说明

所有配置存放在 `.aesyclaw/` 目录：

| 文件          | 说明                                           |
| ------------- | ---------------------------------------------- |
| `config.json` | 主配置：LLM 提供商、消息通道、MCP 服务器、插件 |
| `roles.json`  | 角色定义：身份、提示词、工具/技能权限          |

**最小可用配置** — 只需填入 API 密钥：

```jsonc
// .aesyclaw/config.json
{
  "providers": {
    "openai": { "apiKey": "sk-..." },
  },
}
```

更多配置项参见启动后 Web 仪表盘的配置面板。

## 插件开发

插件分为**功能插件**和**渠道插件**，均存放在 `extensions/` 目录。

### 功能插件

可见 extensions/plugin_example/ 下的示例代码。

**可用 Hooks：** `onReceive` → `beforeLLM` → `beforeToolCall` / `afterToolCall` → `onSend`

### 渠道插件

渠道插件连接消息平台，实现消息收发：

```ts
// extensions/channel_myplatform/index.ts
import type { ChannelPlugin } from '@aesyclaw/sdk';

export default {
  name: 'myplatform',
  version: '0.1.0',

  async init(ctx) {
    // 连接平台，收到消息时调用 ctx.receive(message, sessionKey, sender)
  },
  async send(sessionKey, message) {
    // 向平台发送消息
  },
} satisfies ChannelPlugin;
```

更多示例参见 `extensions/` 目录。

## 项目结构

```
src/
├── agent/        # Agent 引擎与 LLM 适配
├── pipeline/     # 消息处理流水线
├── session/      # 会话管理与历史压缩
├── skill/        # 技能解析与加载
├── extension/    # 插件 & 通道管理器
├── mcp/          # MCP 客户端集成
├── cron/         # 定时任务调度
├── tool/         # 工具注册与适配
├── command/      # 内置斜杠命令
├── role/         # 角色配置与热加载
├── web/          # Hono 服务 + WebSocket
└── sdk/          # 公共 API 导出
extensions/       # 插件 & 通道扩展
web/              # Vue 3 管理前端
```

## 许可证

MIT
