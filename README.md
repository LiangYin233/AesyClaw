# AesyClaw

AesyClaw 是一个轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成（OneBot 等）。

## 特性

- **插件系统**：支持自定义插件扩展功能，提供完整的生命周期钩子
- **Skills 系统**：基于提示词的技能发现和管理
- **会话管理**：基于 SQLite 的持久化会话存储，支持多种上下文模式
- **多渠道集成**：支持 OneBot 等多种消息渠道
- **LLM 提供商**：支持 OpenAI、MiniMax 等多种大语言模型
- **MCP 支持**：完整的 Model Context Protocol 客户端实现
- **定时任务**：灵活的 Cron 任务调度系统
- **WebUI**：Vue 3 + PrimeVue 可视化控制界面，支持实时监控
- **API Server**：RESTful API 接口，可独立启用/禁用
- **模块化架构**：基于依赖注入的清晰架构设计

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
  apiPort: 18792      # API Server 端口
  apiEnabled: true    # 是否启用 API Server

agent:
  defaults:
    model: gpt-4o
    provider: openai
    contextMode: channel  # session | channel | global
    memoryWindow: 50
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
│   ├── agent/          # Agent 核心逻辑
│   ├── api/            # REST API 服务
│   │   └── routes/     # API 路由（plugins, cron, mcp, metrics）
│   ├── bootstrap/      # 服务初始化和生命周期
│   ├── bus/            # 事件总线
│   ├── channels/       # 消息渠道（OneBot 等）
│   ├── config/         # 配置管理
│   ├── constants/      # 常量定义
│   ├── cron/           # 定时任务
│   ├── db/             # 数据库管理
│   ├── logger/         # 日志系统
│   ├── mcp/            # MCP 客户端
│   ├── plugins/        # 插件管理器
│   ├── providers/      # LLM 提供商
│   ├── session/        # 会话管理
│   ├── skills/         # Skills 系统
│   ├── tools/          # 工具注册表
│   └── utils/          # 工具函数
├── webui/              # Vue 3 前端应用
│   ├── src/
│   │   ├── components/ # Vue 组件
│   │   ├── views/      # 页面视图
│   │   ├── stores/     # Pinia 状态管理
│   │   └── utils/      # 前端工具
├── plugins/            # 用户插件目录
├── skills/             # 用户技能目录
├── dist/               # 编译产物
└── config.yaml         # 配置文件
```

## 技术栈

- **后端**：TypeScript + Express + SQLite
- **前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS
- **架构**：模块化设计，依赖注入，事件驱动

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
