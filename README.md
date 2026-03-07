# AesyClaw

AesyClaw 是一个轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成。

## 特性

- **插件系统**：完整的生命周期钩子，支持工具注册、消息拦截、命令处理
- **Skills 系统**：基于提示词的技能发现和管理
- **会话管理**：SQLite 持久化存储，支持 session/channel/global 三种上下文模式
- **多渠道集成**：支持 OneBot 协议，可自行通过 Channel 扩展
- **LLM 提供商**：支持 OpenAI Completion 协议，可自行通过 Provider 扩展
- **MCP 支持**：完整的 Model Context Protocol 客户端，支持本地和远程服务器
- **定时任务**：Cron 表达式调度，支持工具调用和消息发送
- **WebUI**：Vue 3 + PrimeVue 可视化界面，实时监控和配置管理
- **API Server**：RESTful API，支持插件、MCP、定时任务、指标查询
- **性能监控**：内置指标收集系统，支持实时性能分析
- **错误追踪**：ES2022 Error.cause 支持，完整的错误链追踪

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置

编辑 `config.yaml` 配置您的 API 密钥、渠道参数等。

**主要配置项：**
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

log:
  level: info

metrics:
  enabled: true
  maxMetrics: 10000
```

### 运行

```bash
# 开发模式（带热重载）
npm run dev

# 生产模式
npm run build
npm run start:gateway

# 启动所有服务（Gateway + WebUI）
npm run start:all

# 单独启动服务
npm run start:gateway  # 启动 Gateway（包含 API Server）
npm run start:webui    # 仅启动 WebUI

# 查看服务状态
npm run status
```

### 服务端口

- **API Server**: 18792（Gateway 集成）
- **WebUI**: 5173（开发模式）

WebUI 通过代理访问 API Server，无需额外配置。

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
- 完整的生命周期钩子（onLoad, onStart, onStop, onUnload）
- 消息拦截（onMessage, onResponse）
- Agent 钩子（onAgentBefore, onAgentAfter）
- 工具调用拦截（onBeforeToolCall, onToolCall）
- Hook Pipeline 超时保护（5秒）
- 详见 [plugin_dev.md](plugin_dev.md)

### 会话管理
- 三种上下文模式：session（独立会话）、channel（渠道共享）、global（全局共享）
- SQLite 持久化存储
- 自动会话清理和内存管理
- 支持会话切换命令（/new, /list, /switch）

### MCP 集成
- 支持本地进程（stdio）和远程服务器（SSE）
- 动态连接/断开服务器
- 工具自动注册和命名空间隔离
- 超时和错误处理

### 定时任务
- Cron 表达式调度
- 支持工具调用和消息发送
- 动态添加/删除/启用/禁用任务
- 错误恢复机制

### 性能监控
- 实时指标收集（计数器、计时器、仪表）
- 内存使用、数据库查询、工具执行时间
- WebUI 可视化展示
- API 查询接口

## 技术栈

- **后端**：TypeScript 5.3 (ES2022) + Express + SQLite3
- **前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS
- **架构**：依赖注入 + 事件驱动 + Hook Pipeline

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
