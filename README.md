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


## 🛠️ 技术栈

**后端**：TypeScript + Node.js + Express + SQLite3 + WebSocket

**前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS

**架构**：依赖注入 + 事件驱动 + Hook Pipeline

## 📚 文档

- [插件开发指南](docs/PLUGIN_DEVELOPMENT.md)
- [渠道开发指南](docs/CHANNEL_DEVELOPMENT.md)

## 📄 许可证

MIT

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
