# AesyClaw

轻量级 AI Agent 框架。

## 特性

- 多渠道接入：支持 OneBot（QQ）和飞书（实验性），可同时运行多个渠道
- 插件系统：基于生命周期钩子的插件架构，支持消息拦截、内容处理和响应后处理
- 技能系统：Prompt 模板驱动的技能定义，让 Agent 复用常用对话模式
- MCP 集成：支持 Model Context Protocol，可扩展接入外部工具和服务
- 三种上下文模式：session（单会话）、channel（频道级）、global（全局），灵活控制记忆范围
- 记忆系统：可配置的消息窗口 + Facts 持久化存储，支持摘要自动压缩
- 子代理系统：基于 Role 的子代理机制，可拆分复杂任务给专用 Agent
- WebUI 管理界面：Vue 3 + PrimeVue 构建的实时监控、配置管理和 Agent 编辑界面

## 快速开始

```
git clone → npm install → npm start
```

## 架构概览

**技术栈**：TypeScript + Node.js + Express + SQLite | Vue 3 + PrimeVue + Pinia + TailwindCSS

**核心模块**：
- `agent/` — AI Agent 核心，包含执行引擎、命令注册、消息处理
- `channels/` — 消息渠道适配器，支持
- `plugins/` — 插件系统，生命周期钩子驱动
- `skills/` — 技能管理，Prompt 模板
- `session/` — 会话管理，SQLite 持久化
- `mcp/` — MCP 客户端
- `api/` — Express REST API
- `webui/` — Vue 3 管理界面

## WebUI

访问 `http://localhost:5173/?token=你的server.token`

提供 Agent 编辑、配置管理、渠道状态监控、会话查看等管理功能。

---

由 Minimax-M2.5、Anthropic Sonnet 4.6、OpenAI GPT-5.4 构建
