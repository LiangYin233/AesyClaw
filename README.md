# AesyClaw

AesyClaw 是一个轻量级 AI Agent 框架，支持插件系统、会话管理和多渠道集成（OneBot 等）。

## 特性

- 插件系统：支持自定义插件扩展功能
- 会话管理：基于 SQLite 的持久化会话
- 多渠道集成：支持 OneBot 等多种消息渠道
- LLM 提供商：支持多种大语言模型接入
- MCP 客户端：支持 Model Context Protocol
- 定时任务：支持 Cron 任务调度
- WebUI：提供可视化控制界面

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
```

### WebUI

访问 http://localhost:5173 进入可视化控制界面。

## 项目结构

```
├── src/             # 源代码
├── webui/           # 前端 Vue 3 应用
├── plugins/         # 插件目录
├── dist/            # 编译产物
└── config.yaml      # 配置文件
```

## 技术栈

- 后端：TypeScript + Express + SQLite
- 前端：Vue 3 + PrimeVue + TailwindCSS

---

由 MiniMax M2.5 实现
