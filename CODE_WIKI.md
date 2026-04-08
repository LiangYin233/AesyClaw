# AesyClaw 项目 Code Wiki

## 1. 项目概述

AesyClaw 是一个基于大型语言模型 (LLM) 的智能代理系统，提供了完整的对话管理、工具调用、插件扩展和多通道支持功能。

- **模块化架构**：采用清晰的模块划分，便于扩展和维护
- **多通道支持**：通过插件系统支持多种输入输出通道
- **工具集成**：内置丰富的工具集，支持 MCP (Model Context Protocol) 集成
- **会话管理**：完整的会话记忆和状态管理
- **角色系统**：支持不同角色的权限和行为定义
- **技能系统**：可扩展的技能库

## 2. 目录结构

```
├── plugins/            # 通道插件目录
│   ├── channel_onebot/ # OneBot 协议通道
│   └── plugin_exec/    # 执行插件
├── skills/             # 技能定义目录
│   ├── aesyclaw-deep-research/  # 深度研究技能
│   └── aesyclaw-skill-creator/  # 技能创建器
├── src/                # 源代码目录
│   ├── agent/          # 代理核心模块
│   ├── channels/       # 通道管理
│   ├── features/       # 功能模块
│   ├── middlewares/    # 中间件
│   ├── platform/       # 平台基础设施
│   ├── bootstrap.ts    # 系统启动
│   └── index.ts        # 入口文件
├── package.json        # 项目配置和依赖
└── tsconfig.json       # TypeScript 配置
```

## 3. 系统架构

AesyClaw 采用分层架构设计，各模块职责明确，相互协作完成智能代理的核心功能。

### 3.1 核心架构图

```
┌─────────────────────────────────────────────────────────┐
│                      通道层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ OneBot 通道  │  │ 其他通道    │  │ 其他通道    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
├─────────────────────────────────────────────────────────┤
│                      中间件层                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 配置中间件   │  │ 会话中间件   │  │ 代理中间件   │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
├─────────────────────────────────────────────────────────┤
│                      核心层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 代理引擎    │  │ 会话管理    │  │ 工具执行    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
├─────────────────────────────────────────────────────────┤
│                      功能层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 技能系统    │  │ 角色系统    │  │ 插件系统    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
├─────────────────────────────────────────────────────────┤
│                      平台层                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│  │ 工具注册    │  │ 数据库      │  │ 事件总线    │      │
│  └─────────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### 3.2 核心流程

1. **启动流程**：通过 `bootstrap.ts` 初始化各模块
2. **请求处理**：通道接收请求 → 中间件处理 → 代理引擎处理 → 工具调用 → 响应返回
3. **会话管理**：维护会话状态和历史记录，支持记忆压缩
4. **工具执行**：根据角色权限执行相应工具，处理工具结果

## 4. 主要模块

### 4.1 代理核心 (Agent Core)

代理核心模块是系统的核心处理单元，负责与 LLM 交互、管理会话、执行工具等功能。

#### 4.1.1 AgentEngine

[AgentEngine](file:///workspace/src/agent/core/engine.ts) 是代理的核心执行引擎，负责处理用户请求、与 LLM 交互、执行工具调用等。

**主要功能**：
- 管理 LLM 会话
- 处理用户输入
- 执行工具调用
- 维护会话记忆
- 处理角色权限

**关键方法**：
- `run(userInput: string)`: 处理用户输入并返回结果
- `getSession()`: 获取或创建 LLM 会话
- `getFilteredTools()`: 根据角色权限过滤工具

### 4.2 通道系统 (Channels)

通道系统负责处理不同来源的输入和输出，通过插件机制支持多种通道类型。

#### 4.2.1 ChannelManager

[ChannelManager](file:///workspace/src/channels/channel-manager.ts) 管理所有通道插件，负责通道的注册、消息分发等。

**主要功能**：
- 注册通道插件
- 管理通道生命周期
- 分发消息到相应通道

### 4.3 功能模块 (Features)

#### 4.3.1 技能系统 (Skills)

技能系统提供可扩展的技能库，支持动态加载和执行技能。

**主要组件**：
- `SkillManager`: 管理技能的加载和执行
- `loadSkillTool`: 加载技能的工具

#### 4.3.2 角色系统 (Roles)

角色系统定义不同角色的权限和行为，控制工具的使用权限。

**主要组件**：
- `RoleManager`: 管理角色定义和权限
- `SystemPromptManager`: 管理系统提示

#### 4.3.3 插件系统 (Plugins)

插件系统支持扩展系统功能，包括通道插件和功能插件。

**主要组件**：
- `PluginManager`: 管理插件的加载和生命周期

#### 4.3.4 命令系统 (Commands)

命令系统处理系统命令，提供系统级功能。

**主要组件**：
- `CommandRegistry`: 注册系统命令
- `commandMiddleware`: 命令处理中间件

### 4.4 平台基础设施 (Platform)

#### 4.4.1 工具系统 (Tools)

工具系统提供各种工具的注册和执行机制。

**主要组件**：
- `ToolRegistry`: 注册和管理工具
- `McpClientManager`: 管理 MCP 客户端

#### 4.4.2 数据库系统 (DB)

数据库系统提供数据存储功能，使用 SQLite 作为存储引擎。

**主要组件**：
- `SqliteManager`: 管理 SQLite 数据库连接
- `SessionRepository`: 会话数据存储
- `CronJobRepository`: 定时任务存储

#### 4.4.3 事件系统 (Events)

事件系统提供事件发布和订阅机制。

**主要组件**：
- `EventBus`: 事件总线，处理事件的发布和订阅

## 5. 关键类与函数

### 5.1 Bootstrap 类

[Bootstrap](file:///workspace/src/bootstrap.ts) 负责系统的初始化和启动，协调各模块的初始化顺序。

**主要方法**：
- `initialize(options: BootstrapOptions)`: 初始化系统
- `shutdown()`: 关闭系统
- `getStatus()`: 获取系统状态

### 5.2 AgentEngine 类

[AgentEngine](file:///workspace/src/agent/core/engine.ts) 是代理的核心执行引擎。

**主要方法**：
- `run(userInput: string)`: 处理用户输入并返回结果
- `getHistory()`: 获取会话历史
- `clearHistory()`: 清除会话历史
- `getMemoryStats()`: 获取记忆统计信息

### 5.3 SessionMemoryManager 类

[SessionMemoryManager](file:///workspace/src/agent/core/memory/session-memory-manager.ts) 管理会话记忆，支持记忆压缩和令牌预算管理。

**主要方法**：
- `addMessage(message: StandardMessage)`: 添加消息到记忆
- `getMessages()`: 获取记忆中的消息
- `clear()`: 清除记忆
- `checkBudget()`: 检查令牌预算

### 5.4 ToolRegistry 类

[ToolRegistry](file:///workspace/src/platform/tools/registry.ts) 管理工具的注册和执行。

**主要方法**：
- `register(tool: ITool)`: 注册工具
- `executeTools(toolCalls: ToolCallRequest[], context: ToolExecuteContext)`: 执行工具调用
- `getAllToolDefinitions()`: 获取所有工具定义

### 5.5 ChannelManager 类

[ChannelManager](file:///workspace/src/channels/channel-manager.ts) 管理通道插件。

**主要方法**：
- `registerChannel(channel: ChannelPlugin, config: Record<string, unknown>)`: 注册通道
- `getChannelCount()`: 获取通道数量
- `shutdown()`: 关闭所有通道

## 6. 依赖关系

| 依赖项 | 版本 | 用途 | 来源 |
|-------|------|------|------|
| @anthropic-ai/sdk | ^0.82.0 | Anthropic LLM API 客户端 | [package.json](file:///workspace/package.json) |
| @modelcontextprotocol/sdk | ^1.29.0 | MCP 协议客户端 | [package.json](file:///workspace/package.json) |
| better-sqlite3 | ^12.8.0 | SQLite 数据库 | [package.json](file:///workspace/package.json) |
| node-cron | ^4.2.1 | 定时任务调度 | [package.json](file:///workspace/package.json) |
| openai | ^6.33.0 | OpenAI LLM API 客户端 | [package.json](file:///workspace/package.json) |
| pino | ^10.3.1 | 日志系统 | [package.json](file:///workspace/package.json) |
| pino-pretty | ^13.1.3 | 日志格式化 | [package.json](file:///workspace/package.json) |
| ws | ^8.18.0 | WebSocket 支持 | [package.json](file:///workspace/package.json) |
| zod | ^4.3.6 | 数据验证 | [package.json](file:///workspace/package.json) |

## 7. 项目运行方式

### 7.1 安装依赖

```bash
yarn install
```

### 7.2 开发模式运行

```bash
yarn dev
```

### 7.3 生产模式运行

```bash
yarn build
yarn start
```

### 7.4 系统启动流程

1. 初始化路径解析器
2. 加载配置
3. 初始化 SQLite 数据库
4. 初始化技能系统
5. 初始化角色系统
6. 注册子代理工具
7. 注册多模态工具
8. 挂载中间件
9. 注册系统命令
10. 初始化插件系统
11. 初始化定时任务系统
12. 连接 MCP 服务器
13. 加载通道插件

## 8. 核心功能详解

### 8.1 会话管理

会话管理系统负责维护会话状态和历史记录，支持记忆压缩和令牌预算管理，确保对话的连续性和上下文理解。

**主要功能**：
- 消息存储和检索
- 记忆压缩（通过 lossless-summarizer）
- 令牌预算管理
- 会话状态维护

### 8.2 工具调用

工具调用系统允许代理执行各种工具，扩展其能力范围。

**主要功能**：
- 工具注册和管理
- 工具权限控制（基于角色）
- 工具执行和结果处理
- MCP 工具集成

### 8.3 插件系统

插件系统支持扩展系统功能，包括通道插件和功能插件。

**主要功能**：
- 插件扫描和加载
- 插件生命周期管理
- 插件钩子系统

### 8.4 角色系统

角色系统定义不同角色的权限和行为，控制工具的使用权限。

**主要功能**：
- 角色定义和管理
- 权限控制
- 系统提示管理

## 9. 配置管理

系统使用配置管理器管理全局配置，支持默认配置和用户配置。

**主要组件**：
- `ConfigManager`: 管理配置的加载和同步
- `configManager`: 配置管理器实例

**配置项**：
- LLM 配置（模型、API 密钥等）
- 通道配置
- 插件配置
- MCP 服务器配置

## 10. 监控与日志

系统使用 Pino 日志系统进行日志记录，支持不同级别的日志输出。

**主要组件**：
- `logger`: 日志实例

**日志级别**：
- debug: 调试信息
- info: 普通信息
- warn: 警告信息
- error: 错误信息

## 11. 扩展与开发

### 11.1 添加新通道

1. 在 `plugins/` 目录下创建新的通道插件目录
2. 实现通道插件接口
3. 在配置中启用通道

### 11.2 添加新工具

1. 实现工具接口
2. 在系统启动时注册工具

### 11.3 添加新技能

1. 在 `skills/` 目录下创建新的技能目录
2. 编写技能定义文件
3. 系统会自动加载技能

## 12. 常见问题与解决方案

### 12.1 通道插件加载失败

**问题**：通道插件加载失败
**解决方案**：检查插件目录结构和 package.json 文件，确保插件名称匹配

### 12.2 工具权限错误

**问题**：工具执行时出现权限错误
**解决方案**：检查角色权限配置，确保角色有执行该工具的权限

### 12.3 内存不足

**问题**：会话内存不足
**解决方案**：调整内存配置，增加令牌预算或优化记忆压缩策略

## 13. 总结

AesyClaw 是一个功能强大、架构清晰的智能代理系统，提供了完整的对话管理、工具调用、插件扩展和多通道支持功能。通过模块化的设计和丰富的扩展机制，AesyClaw 可以适应各种应用场景，为用户提供智能、高效的交互体验。

系统的核心优势在于：
- 模块化架构，易于扩展和维护
- 完整的会话管理和记忆系统
- 丰富的工具集成和插件系统
- 多通道支持，适应不同场景
- 角色系统，提供权限控制

AesyClaw 为构建智能代理应用提供了坚实的基础，可用于客服、助手、教育等多种场景。