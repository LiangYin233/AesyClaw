# AesyClaw

轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成。

## ✨ 特性

- **🔌 插件系统**：完整的生命周期钩子，支持工具注册、消息拦截、命令处理、Agent 钩子
- **🎯 Skills 系统**：基于提示词的技能发现和管理
- **💾 会话管理**：SQLite 持久化，支持 session/channel/global 三种上下文模式
- **📡 多渠道集成**：支持 OneBot、飞书，可扩展自定义渠道
- **🤖 LLM 提供商**：支持 OpenAI Completion 协议，可扩展
- **🔧 MCP 支持**：完整的 Model Context Protocol 客户端
- **⏰ 定时任务**：Cron 表达式调度
- **🎨 WebUI**：Vue 3 + PrimeVue 可视化界面
- **🌐 API Server**：RESTful API
- **📊 性能监控**：内置指标收集系统

## 🚀 快速开始

### 安装

```bash
npm install
cd webui && npm install
```

### 配置

编辑 `config.yaml` 配置文件：

```yaml
agent:
  defaults:
    model: your-model
    provider: your-provider

channels:
  onebot:
    enabled: true
    wsUrl: ws://your-onebot-server

providers:
  your-provider:
    apiKey: your-api-key
    apiBase: https://api.example.com
```

### 运行

```bash
# 启动后端服务
npm run start:gateway

# 启动 WebUI（开发模式）
npm run dev:webui

# 同时启动所有服务
npm run start:all
```

访问 WebUI：http://localhost:5173

## 📁 项目结构

```
├── src/                    # 后端源代码
│   ├── agent/              # Agent 核心逻辑
│   ├── api/                # REST API 服务
│   ├── channels/           # 消息渠道
│   ├── plugins/            # 插件管理器
│   ├── mcp/                # MCP 客户端
│   └── ...
├── webui/                  # Vue 3 前端
├── plugins/                # 用户插件
├── skills/                 # 用户技能
├── workspace/              # 工作目录
├── .aesyclaw/              # 数据存储目录
│   ├── sessions/           # 会话数据库
│   ├── cron-jobs.db        # 定时任务数据库
│   ├── token-stats.json    # Token 统计
│   └── temp/               # 临时文件
└── docs/                   # 文档
```

## 🛠️ 技术栈

**后端**：TypeScript + Node.js + Express + SQLite3 + WebSocket

**前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS

**架构**：依赖注入 + 事件驱动 + Hook Pipeline

## 💻 开发

### 插件开发

```typescript
const myPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  async onMessage(msg) {
    // 处理消息
    return msg;
  },

  tools: [{
    name: 'my_tool',
    description: '我的工具',
    parameters: { /* JSON Schema */ },
    execute: async (params) => {
      return '结果';
    }
  }]
};

export default myPlugin;
```

详见 [docs/PLUGIN_DEVELOPMENT.md](docs/PLUGIN_DEVELOPMENT.md)

### 渠道扩展

```typescript
export class MyChannel extends BaseChannel {
  async start() { /* 连接平台 */ }
  async stop() { /* 断开连接 */ }
  async send(msg: OutboundMessage) { /* 发送消息 */ }
  protected async parseMessage(rawEvent: any): Promise<ParsedMessage> {
    // 解析消息
  }
}
```

详见 [docs/CHANNEL_DEVELOPMENT.md](docs/CHANNEL_DEVELOPMENT.md)

## 📚 文档

- [插件开发指南](docs/PLUGIN_DEVELOPMENT.md)
- [渠道开发指南](docs/CHANNEL_DEVELOPMENT.md)

## 📄 许可证

MIT

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
