# AesyClaw

轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成。

## 特性

- **插件系统**：完整的生命周期钩子，支持工具注册、消息拦截、命令处理
- **Skills 系统**：基于提示词的技能发现和管理
- **会话管理**：SQLite 持久化存储，支持 session/channel/global 三种上下文模式
- **多渠道集成**：支持 OneBot、飞书，可自行通过 Channel 扩展
- **LLM 提供商**：支持 OpenAI Completion 协议，可自行通过 Provider 扩展
- **MCP 支持**：完整的 Model Context Protocol 客户端，支持本地和远程服务器
- **定时任务**：Cron 表达式调度，支持工具调用和消息发送
- **WebUI**：Vue 3 + PrimeVue 可视化界面，实时监控和配置管理
- **API Server**：RESTful API，支持插件、MCP、定时任务、指标查询
- **性能监控**：内置指标收集系统，支持实时性能分析

## 快速开始

### 环境要求

- Node.js 18+
- npm 或 pnpm

### 安装

```bash
npm install
```

### 配置

复制并编辑配置文件：

```bash
cp config.example.yaml config.yaml
```

**核心配置：**
```yaml
server:
  host: 0.0.0.0
  apiPort: 18792
  apiEnabled: true

agent:
  defaults:
    model: gpt-4o
    provider: openai
    contextMode: channel      # session | channel | global
    memoryWindow: 50
    maxToolIterations: 40
    maxSessions: 100

channels:
  onebot:
    enabled: true
    wsUrl: ws://localhost:3001/ws
    token: your-token
  feishu:
    enabled: false
    appId: cli_xxxxx
    appSecret: xxxxx
    verificationToken: xxxxx
    webhookPort: 8080
    webhookPath: /feishu/webhook

providers:
  openai:
    apiKey: sk-xxx
    apiBase: https://api.openai.com/v1

mcp:
  playwright:
    type: local
    command: '["npx", "-y", "@playwright/mcp@latest"]'
    enabled: true

plugins:
  exec:
    enabled: true
  websearch:
    enabled: true
  md2img:
    enabled: false
    options:
      minLength: 50
      scale: 1.0

log:
  level: info

metrics:
  enabled: true
  maxMetrics: 10000
```

### 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# 启动 WebUI（开发模式）
cd webui && npm run dev
```

访问 WebUI：http://localhost:5173

## 项目结构

```
├── src/
│   ├── agent/              # Agent 核心逻辑和命令系统
│   ├── api/                # REST API 服务
│   │   └── routes/         # API 路由（plugins, cron, mcp, metrics）
│   ├── bootstrap/          # 服务初始化和依赖注入
│   ├── bus/                # 事件总线
│   ├── channels/           # 消息渠道（OneBot 等）
│   ├── config/             # 配置加载和管理
│   ├── constants/          # 常量定义
│   ├── cron/               # 定时任务调度
│   ├── db/                 # SQLite 数据库
│   ├── logger/             # 日志和错误处理
│   ├── mcp/                # MCP 客户端管理
│   ├── plugins/            # 插件管理器和 Hook Pipeline
│   ├── providers/          # LLM 提供商适配器
│   ├── session/            # 会话管理
│   ├── skills/             # Skills 系统
│   ├── tools/              # 工具注册表
│   └── types.ts            # TypeScript 类型定义
├── webui/                  # Vue 3 前端应用
│   ├── src/
│   │   ├── components/     # Vue 组件
│   │   ├── views/          # 页面视图
│   │   ├── stores/         # Pinia 状态管理
│   │   └── router/         # Vue Router
├── plugins/                # 用户插件目录
├── skills/                 # 用户技能目录
└── config.yaml             # 主配置文件
```

## 核心功能

### 插件系统
- 生命周期钩子：onLoad, onStart, onStop, onUnload
- 消息拦截：onMessage, onResponse
- Agent 钩子：onAgentBefore, onAgentAfter
- 工具调用拦截：onBeforeToolCall, onToolCall
- 详见 [plugin_dev.md](plugin_dev.md)

### 会话管理
- 三种上下文模式：session（独立）、channel（渠道共享）、global（全局共享）
- SQLite 持久化存储
- 会话命令：/new, /list, /switch

### 渠道支持
- **OneBot**：QQ、Telegram 等（通过 OneBot 协议）
- **飞书**：企业消息机器人，支持文本、图片、文件

### MCP 集成
- 本地进程（stdio）和远程服务器（SSE）
- 动态连接/断开
- 工具自动注册和命名空间隔离

### 定时任务
- Cron 表达式调度
- 支持工具调用和消息发送
- 动态管理（添加/删除/启用/禁用）

### 内置插件
- **exec**：执行 Shell 命令
- **websearch**：网络搜索（需配置 API）
- **md2img**：Markdown 转图片（使用思源字体）

## 技术栈

- **后端**：TypeScript 5.3 + Node.js 18+ + Express + SQLite3
- **前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS
- **架构**：依赖注入 + 事件驱动 + Hook Pipeline

## 开发

### 插件开发

在 `plugins/` 目录创建插件：

```javascript
export default {
  name: 'my-plugin',
  version: '1.0.0',
  async onLoad(context) {
    // 初始化
  },
  async onMessage(msg) {
    // 拦截消息
    return msg;
  }
};
```

详见 [plugin_dev.md](plugin_dev.md)

### 渠道扩展

继承 `BaseChannel` 类实现自定义渠道：

```typescript
export class MyChannel extends BaseChannel {
  async start() { /* 启动逻辑 */ }
  async stop() { /* 停止逻辑 */ }
  async send(msg: OutboundMessage) { /* 发送消息 */ }
}
```

### API 接口

- `GET /api/plugins` - 插件列表
- `GET /api/mcp/servers` - MCP 服务器列表
- `GET /api/cron/jobs` - 定时任务列表
- `GET /api/metrics` - 性能指标

## 许可证

MIT

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
