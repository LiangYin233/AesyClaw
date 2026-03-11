# AesyClaw

轻量级 AI Agent 框架。

## 特性

- 插件系统：生命周期钩子、工具注册、消息拦截
- Skills：基于提示词的技能管理
- 会话管理：SQLite 持久化，支持 session/channel/global 模式
- 多渠道：OneBot、飞书（实验性）
- LLM 提供商：OpenAI 兼容协议
- MCP 支持
- Cron 定时任务
- WebUI：Vue 3 + PrimeVue

## 快速开始

```bash
npm install
cd webui && npm install
npm run start:all
```

访问 `http://localhost:5173/?token=你的server.token`

## 配置

编辑 `config.toml`：

```toml
[server]
apiPort = 18792
token = "auto-generated-token"

[agent.defaults]
provider = "openai"
model = "gpt-4o"

[providers.openai]
apiKey = "sk-xxx"

[channels.onebot]
enabled = true
wsUrl = "ws://127.0.0.1:6700/ws"
```

## 技术栈

后端：TypeScript + Node.js + Express + SQLite

前端：Vue 3 + PrimeVue + Pinia + TailwindCSS

---

由 Minimax-M2.5、Anthropic Sonnet 4.6、OpenAI GPT-5.4 构建
