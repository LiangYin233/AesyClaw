# 配置文件说明

`config.toml` 位于项目根目录，TOML 格式，修改后自动重载。

## 配置项

### server

```toml
[server]
host = "0.0.0.0"
apiPort = 18792
apiEnabled = true
token = "auto-generated-token"
```

访问 WebUI 时请带上 `?token=`，例如：`http://localhost:5173/?token=你的server.token`。WebUI 内部路由切换会自动保留该参数。

### agent.defaults

```toml
[agent.defaults]
provider = "openai"
model = "gpt-4o"
maxToolIterations = 40
memoryWindow = 50
contextMode = "channel"
maxSessions = 100
systemPrompt = "..."
vision = false
reasoning = false
```

### 记忆配置

摘要记忆：
```toml
[agent.defaults.memorySummary]
enabled = true
provider = "openai"
model = "gpt-4o-mini"
triggerMessages = 20
```

长期事实：
```toml
[agent.defaults.memoryFacts]
enabled = true
provider = "openai"
model = "gpt-4o-mini"
maxFacts = 20
```

### providers

```toml
[providers.openai]
apiKey = "sk-xxx"
apiBase = "https://api.openai.com/v1"
model = "gpt-4o"

[providers.cheap]
apiKey = "sk-xxx"
apiBase = "https://api.openai.com/v1"
model = "gpt-4o-mini"
```

### channels.onebot

```toml
[channels.onebot]
enabled = true
wsUrl = "ws://127.0.0.1:6700/ws"
httpUrl = "http://127.0.0.1:5700"
token = ""
friendAllowFrom = []
groupAllowFrom = []
```

### channels.feishu

```toml
[channels.feishu]
enabled = true
appId = "cli_xxx"
appSecret = "xxx"
verificationToken = "xxx"
webhookPort = 18793
webhookPath = "/feishu/webhook"
friendAllowFrom = []
groupAllowFrom = []
```

### mcp

本地命令型：
```toml
[mcp.filesystem]
type = "local"
command = ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/path"]
enabled = true
```

HTTP 型：
```toml
[mcp.myserver]
type = "http"
url = "http://127.0.0.1:3000/mcp"
enabled = true
```

### skills

```toml
[skills."my-skill"]
enabled = true
```

### log

```toml
[log]
level = "debug"
```

### metrics

```toml
[metrics]
enabled = true
maxMetrics = 10000
```

### tools

```toml
[tools]
blacklist = ["shell_exec", "python_exec"]
timeoutMs = 30000
```

## 常见问题

### 修改配置需要重启吗？

不需要，程序会监听配置文件变化自动重载。

### contextMode 怎么选？

- 聊天机器人：`channel`
- 每次对话隔离：`session`
- 全局共享：`global`
