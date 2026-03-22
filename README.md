# AesyClaw

轻量级 AI Agent 框架。

## 特性

- 多渠道接入：支持 OneBot 与飞书（实验性）接入，可同时运行多渠道消息入口
- 插件系统：支持代码执行、语音转文字、Web搜索等扩展能力
- 技能系统：支持复用常用任务流程与对话模式
- MCP 集成：支持接入外部工具与服务
- 上下文模式：支持 session、channel 两种上下文范围
- 记忆系统：支持消息窗口、摘要压缩与 Facts 持久化
- 多 Agent 协作：支持按角色拆分复杂任务给专用 Agent
- WebUI 管理界面：支持配置管理、会话查看、渠道状态监控与 Agent 管理

## 快速开始

```bash
git clone <repo> && cd AesyClaw
npm install
npm run start:all
```

## 架构概览

**技术栈**：
- 后端：TypeScript + Node.js + Express + SQLite
- 前端：Vue 3 + Tailwind CSS + Vite

**核心模块**：
- `agent/` — AI Agent 核心，包含执行引擎、命令注册、消息处理
- `channels/` — 消息渠道适配器，支持 OneBot 和飞书
- `plugins/` — 插件系统，生命周期钩子驱动
- `skills/` — 技能管理，Prompt 模板
- `session/` — 会话管理，SQLite 持久化
- `mcp/` — MCP 客户端
- `api/` — Express REST API
- `webui/` — Vue 3 管理界面

## WebUI

访问 `http://localhost:5173/?token=你的server.token`

提供 Agent 编辑、配置管理、渠道状态监控、会话查看等管理功能。
