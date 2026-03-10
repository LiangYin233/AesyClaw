# 配置文件说明

`config.yaml` 位于项目根目录，YAML 格式，修改后自动重载。

## 配置项

### server

```yaml
server:
  host: 0.0.0.0        # 监听地址
  apiPort: 18792       # API 端口
  apiEnabled: true     # 是否启用 API
```

### agent.defaults

```yaml
agent:
  defaults:
    provider: openai           # 使用的 provider
    model: gpt-4o              # 默认模型
    maxToolIterations: 40      # 最大工具调用次数
    memoryWindow: 50           # 上下文消息数
    contextMode: channel       # 会话模式: session/channel/global
    maxSessions: 100           # 最大会话数
    systemPrompt: "..."
    vision: false             # 是否启用视觉
    reasoning: false           # 是否启用推理
```

### 记忆配置

摘要记忆：
```yaml
agent:
  defaults:
    memorySummary:
      enabled: true
      provider: openai
      model: gpt-4o-mini
      triggerMessages: 20
```

长期事实：
```yaml
agent:
  defaults:
    memoryFacts:
      enabled: true
      provider: openai
      model: gpt-4o-mini
      maxFacts: 20
```

### providers

```yaml
providers:
  openai:
    apiKey: sk-xxx
    apiBase: https://api.openai.com/v1
    model: gpt-4o

  cheap:
    apiKey: sk-xxx
    apiBase: https://api.openai.com/v1
    model: gpt-4o-mini
```

### channels.onebot

```yaml
channels:
  onebot:
    enabled: true
    wsUrl: ws://127.0.0.1:6700/ws
    httpUrl: http://127.0.0.1:5700
    token: ""
    friendAllowFrom: []     # 私聊白名单，空=不限制
    groupAllowFrom: []      # 群聊白名单
```

### channels.feishu

```yaml
channels:
  feishu:
    enabled: true
    appId: cli_xxx
    appSecret: xxx
    verificationToken: xxx
    webhookPort: 18793
    webhookPath: /feishu/webhook
    friendAllowFrom: []
    groupAllowFrom: []
```

### mcp

本地命令型：
```yaml
mcp:
  filesystem:
    type: local
    command: [npx, -y, @modelcontextprotocol/server-filesystem, /path]
    enabled: true
```

HTTP 型：
```yaml
mcp:
  myserver:
    type: http
    url: http://127.0.0.1:3000/mcp
    enabled: true
```

### skills

```yaml
skills:
  my-skill:
    enabled: true
```

### log

```yaml
log:
  level: debug  # debug/info/warn/error
```

### metrics

```yaml
metrics:
  enabled: true
  maxMetrics: 10000
```

### tools

```yaml
tools:
  blacklist: [shell_exec, python_exec]
  timeoutMs: 30000
```

## 常见问题

### 修改配置需要重启吗？

不需要，程序会监听配置文件变化自动重载。

### contextMode 怎么选？

- 聊天机器人：`channel`
- 每次对话隔离：`session`
- 全局共享：`global`
