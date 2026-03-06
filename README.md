# AesyClaw

AesyClaw 是一个轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成（OneBot 等）。

## 特性

- **插件系统**：支持自定义插件扩展功能，提供完整的生命周期钩子
- **Skills 系统**：基于提示词的技能发现和管理
- **会话管理**：基于 SQLite 的持久化会话存储
- **多渠道集成**：支持 OneBot 等多种消息渠道
- **LLM 提供商**：支持 OpenAI、MiniMax 等多种大语言模型
- **MCP 支持**：完整的 Model Context Protocol 客户端实现
- **定时任务**：灵活的 Cron 任务调度系统
- **依赖注入**：基于 DI 容器的模块化架构
- **WebUI**：Vue 3 + PrimeVue 可视化控制界面

## 快速开始

### 安装依赖

```bash
npm install
```

### 配置

编辑 `config.yaml` 配置您的 API 密钥、渠道参数等。

### 运行

```bash
# 开发模式
npm run dev

# 生产模式
npm run build
npm start

# 启动所有服务（网关 + API + WebUI）
npm run start:all

# 单独启动服务
npm run start:gateway  # 仅启动网关
npm run start:api      # 仅启动 API 服务
npm run start:webui    # 仅启动 WebUI
```

### WebUI

开发模式：访问 http://localhost:5173
生产模式：访问配置文件中指定的端口（默认 3000）

## 项目结构

```
├── src/
│   ├── agent/          # Agent 核心逻辑
│   ├── api/            # REST API 服务
│   ├── bootstrap/      # 服务初始化和生命周期
│   ├── bus/            # 事件总线
│   ├── channels/       # 消息渠道（OneBot 等）
│   ├── config/         # 配置管理
│   ├── cron/           # 定时任务
│   ├── di/             # 依赖注入容器
│   ├── mcp/            # MCP 客户端
│   ├── plugins/        # 插件管理器
│   ├── session/        # 会话管理
│   ├── skills/         # Skills 系统
│   ├── tools/          # 工具注册表
│   └── utils/          # 工具函数
├── webui/              # Vue 3 前端应用
├── plugins/            # 用户插件目录
├── dist/               # 编译产物
└── config.yaml         # 配置文件
```

## 技术栈

- **后端**：TypeScript + Express + SQLite + 依赖注入
- **前端**：Vue 3 + PrimeVue + Pinia + TailwindCSS

---

由 MiniMax M2.5 和 Claude Sonnet 4.6 实现
