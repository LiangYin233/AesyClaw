# 配置文件说明

本文档说明 AesyClaw 的用户配置文件 `config.yaml` 应该如何编写。

- 配置文件位置：项目根目录下的 `config.yaml`
- 配置格式：YAML
- 生效方式：程序启动时读取；运行中修改后会自动重载

## 1. 最小可用示例

如果你只是想先跑起来，可以先用下面这份最小配置：

```yaml
server:
  host: 0.0.0.0
  apiPort: 18792
  apiEnabled: true

agent:
  defaults:
    provider: openai
    model: gpt-4o
    maxToolIterations: 40
    memoryWindow: 50
    contextMode: channel
    maxSessions: 100
    systemPrompt: "You are a helpful AI assistant."
    vision: false
    reasoning: false
    visionProvider: ""
    visionModel: ""
    memorySummary:
      enabled: false
      provider: ""
      model: ""
      triggerMessages: 20
    memoryFacts:
      enabled: false
      provider: ""
      model: ""
      maxFacts: 20

channels:
  onebot:
    enabled: false
    wsUrl: ws://127.0.0.1:6700/ws
    httpUrl: http://127.0.0.1:5700
    token: ""
    friendAllowFrom: []
    groupAllowFrom: []

providers:
  openai:
    apiKey: "你的 API Key"
    apiBase: https://api.openai.com/v1

mcp: {}
skills: {}

log:
  level: info

metrics:
  enabled: true
  maxMetrics: 10000

tools:
  blacklist: []
  timeoutMs: 30000
```

## 2. 顶层结构

完整配置通常包含以下顶层字段：

```yaml
server:
agent:
channels:
providers:
mcp:
skills:
log:
metrics:
tools:
```

说明：

- `server`：API 服务相关配置
- `agent`：模型、上下文、记忆、视觉等默认行为
- `channels`：消息渠道配置，例如 OneBot、飞书
- `providers`：大模型提供商配置
- `mcp`：MCP Server 配置
- `skills`：技能启用配置
- `log`：日志级别
- `metrics`：指标采集配置
- `tools`：工具黑名单和超时配置

## 3. `server`

```yaml
server:
  host: 0.0.0.0
  apiPort: 18792
  apiEnabled: true
```

字段说明：

- `host`
  - 监听地址
  - 常用值：`0.0.0.0`、`127.0.0.1`
- `apiPort`
  - API 端口
  - 必须是 `1-65535`
- `apiEnabled`
  - 是否启用 API 服务
  - `true` 表示启用，`false` 表示禁用

建议：

- 本机调试可用 `127.0.0.1`
- 需要局域网访问时可用 `0.0.0.0`

## 4. `agent.defaults`

```yaml
agent:
  defaults:
    provider: openai
    model: gpt-4o
    maxToolIterations: 40
    memoryWindow: 50
    contextMode: channel
    maxSessions: 100
    systemPrompt: "You are a helpful AI assistant."
    vision: false
    reasoning: false
    visionProvider: ""
    visionModel: ""
```

### 4.1 基础模型配置

- `provider`
  - 默认使用的 provider 名称
  - 必须能在 `providers` 节点中找到同名配置
- `model`
  - 默认模型名
- `systemPrompt`
  - 默认系统提示词
  - 可以写成中文或英文
  - 如果不配置，会使用内置默认提示词

### 4.2 工具与上下文配置

- `maxToolIterations`
  - 一次任务中，Agent 最多允许多少轮工具调用
  - 默认 `40`
  - 过大可能增加耗时和 token 消耗
- `memoryWindow`
  - 在上下文中保留最近多少条消息
  - 默认 `50`
- `contextMode`
  - 会话路由模式
  - 可选值：
    - `session`：每次会话独立
    - `channel`：同一聊天对象共享上下文
    - `global`：全局共享上下文
- `maxSessions`
  - 最多保留多少个 session
  - 超出后会自动清理较旧会话

一般建议：

- 私聊/群聊机器人：`contextMode: channel`
- 严格隔离每次对话：`contextMode: session`
- 不建议普通用户使用 `global`

### 4.3 视觉与推理配置

```yaml
agent:
  defaults:
    vision: false
    reasoning: false
    visionProvider: openai
    visionModel: gpt-4o
```

字段说明：

- `vision`
  - 是否启用视觉能力
  - 启用后，模型可以处理图片等视觉输入
- `reasoning`
  - 是否启用推理模式
  - 是否生效取决于 provider 是否支持
- `visionProvider`
  - 视觉模型使用的 provider 名称
  - 留空时通常不会单独路由视觉模型
- `visionModel`
  - 视觉模型名称

建议：

- 不需要图片理解时，保持 `vision: false`
- 如果主模型不适合做视觉，可以单独指定 `visionProvider` 和 `visionModel`

## 5. 记忆配置

当前记忆分为两类：

- 摘要记忆：对历史消息做压缩总结
- 长期事实：提取相对稳定、可长期复用的信息

### 5.1 摘要记忆 `memorySummary`

```yaml
agent:
  defaults:
    memorySummary:
      enabled: true
      provider: openai
      model: gpt-4o-mini
      triggerMessages: 20
```

字段说明：

- `enabled`
  - 是否启用摘要记忆
- `provider`
  - 生成摘要使用的 provider
  - 留空时会回退到 `agent.defaults.provider`
- `model`
  - 生成摘要使用的模型
  - 留空时会回退到默认模型
- `triggerMessages`
  - 积累多少条待总结消息后触发一次摘要
  - 必须 `>= 1`

建议：

- 想省钱时，可单独给摘要配置低成本模型
- `triggerMessages` 太小会增加调用频率，太大则摘要更新不及时

### 5.2 长期事实 `memoryFacts`

```yaml
agent:
  defaults:
    memoryFacts:
      enabled: true
      provider: openai
      model: gpt-4o-mini
      maxFacts: 20
```

字段说明：

- `enabled`
  - 是否启用长期事实提取
- `provider`
  - 提取事实使用的 provider
  - 留空时回退到默认 provider
- `model`
  - 提取事实使用的模型
- `maxFacts`
  - 最多保留多少条长期事实
  - 必须 `>= 1`

建议：

- 摘要和长期事实可以使用比主对话更便宜的模型
- 如果事实变化很快，不建议把 `maxFacts` 设得太大

## 6. `providers`

`providers` 用来定义可被 Agent 使用的模型提供商。

```yaml
providers:
  openai:
    apiKey: sk-xxx
    apiBase: https://api.openai.com/v1
    model: gpt-4o
    headers: {}
    extraBody: {}

  custom:
    apiKey: xxx
    apiBase: https://your-api.example.com/v1
    model: your-model
```

字段说明：

- `apiKey`
  - 访问该 provider 的密钥
- `apiBase`
  - 接口根地址
- `model`
  - provider 的默认模型
  - 如果 `agent.defaults.model` 已写，一般以调用时指定值为准
- `headers`
  - 额外请求头
- `extraBody`
  - 额外请求体字段

建议：

- `provider` 名称要稳定，例如 `openai`、`openai_cheap`、`myproxy`
- 如果你要给摘要/长期事实单独使用低成本模型，可以新建一个 provider 名称，然后在 `memorySummary` / `memoryFacts` 中引用它

示例：

```yaml
providers:
  openai:
    apiKey: sk-main
    apiBase: https://api.openai.com/v1
    model: gpt-4o

  openai_cheap:
    apiKey: sk-main
    apiBase: https://api.openai.com/v1
    model: gpt-4o-mini
```

然后：

```yaml
agent:
  defaults:
    provider: openai
    model: gpt-4o
    memorySummary:
      enabled: true
      provider: openai_cheap
      model: gpt-4o-mini
    memoryFacts:
      enabled: true
      provider: openai_cheap
      model: gpt-4o-mini
```

## 7. `channels`

`channels` 用于配置消息来源和消息发送渠道。

### 7.1 OneBot

```yaml
channels:
  onebot:
    enabled: true
    wsUrl: ws://127.0.0.1:6700/ws
    httpUrl: http://127.0.0.1:5700
    token: ""
    friendAllowFrom: []
    groupAllowFrom: []
    heartbeatInterval: 30000
    maxReconnectAttempts: 0
    reconnectBaseDelay: 1000
    reconnectMaxDelay: 30000
```

常用字段：

- `enabled`
  - 是否启用 OneBot 渠道
- `wsUrl`
  - OneBot WebSocket 地址
  - 启用时建议必须配置
- `httpUrl`
  - OneBot HTTP 地址
  - 某些发送能力或生态可能会用到
- `token`
  - 鉴权 token
- `friendAllowFrom`
  - 私聊白名单，空数组表示不限制
- `groupAllowFrom`
  - 群聊白名单，空数组表示不限制
- `heartbeatInterval`
  - 心跳间隔，单位毫秒
- `maxReconnectAttempts`
  - 最大重连次数
  - `0` 通常表示不限
- `reconnectBaseDelay`
  - 重连基础延迟，单位毫秒
- `reconnectMaxDelay`
  - 重连最大延迟，单位毫秒

### 7.2 飞书 Feishu

```yaml
channels:
  feishu:
    enabled: true
    appId: cli_xxx
    appSecret: xxx
    verificationToken: xxx
    webhookPort: 18793
    webhookPath: /feishu/webhook
    apiBase: https://open.feishu.cn
    friendAllowFrom: []
    groupAllowFrom: []
```

常用字段：

- `enabled`
  - 是否启用飞书渠道
- `appId`
  - 飞书应用 ID
- `appSecret`
  - 飞书应用密钥
- `verificationToken`
  - 事件订阅验证 token
- `webhookPort`
  - 接收飞书事件的本地端口
- `webhookPath`
  - 接收飞书事件的路径
- `apiBase`
  - 飞书 API 根地址
  - 中国大陆通常用 `https://open.feishu.cn`
- `friendAllowFrom`
  - 私聊白名单
- `groupAllowFrom`
  - 群聊白名单

说明：

- `channels` 下可同时配置多个渠道
- 只有 `enabled: true` 的渠道才会启动

## 8. `mcp`

如果你要接入 MCP Server，可在 `mcp` 中配置。

### 8.1 本地命令型 MCP

```yaml
mcp:
  filesystem:
    type: local
    command:
      - npx
      - -y
      - @modelcontextprotocol/server-filesystem
      - /path/to/workspace
    enabled: true
    timeout: 30000
    environment: {}
```

### 8.2 HTTP 型 MCP

```yaml
mcp:
  myserver:
    type: http
    url: http://127.0.0.1:3000/mcp
    enabled: true
    timeout: 30000
    headers: {}
```

字段说明：

- `type`
  - `local` 或 `http`
- `command`
  - 本地 MCP 启动命令数组，仅 `local` 使用
- `url`
  - MCP 服务地址，仅 `http` 使用
- `enabled`
  - 是否启用
- `timeout`
  - 超时时间，单位毫秒
- `environment`
  - 仅本地命令型可用，注入的环境变量
- `headers`
  - 仅 HTTP 型可用，额外请求头

## 9. `skills`

`skills` 用于控制技能是否启用。

```yaml
skills:
  my-skill:
    enabled: true
  another-skill:
    enabled: false
```

说明：

- key 是技能名称
- `enabled` 表示是否启用该技能
- 技能内容本身不写在 `config.yaml` 中，而是由技能文件决定

## 10. `log`

```yaml
log:
  level: info
```

可选值：

- `debug`
- `info`
- `warn`
- `error`

建议：

- 调试问题时用 `debug`
- 日常运行用 `info`

## 11. `metrics`

```yaml
metrics:
  enabled: true
  maxMetrics: 10000
```

字段说明：

- `enabled`
  - 是否启用指标采集
- `maxMetrics`
  - 最多保留多少条指标数据

建议：

- 普通使用可保持默认
- 如果长期运行且内存敏感，可以适当调低 `maxMetrics`

## 12. `tools`

```yaml
tools:
  blacklist:
    - shell_exec
    - python_exec
  timeoutMs: 30000
```

字段说明：

- `blacklist`
  - 工具黑名单
  - 被列入的工具不会注册给 Agent 使用
- `timeoutMs`
  - 工具默认超时时间，单位毫秒

建议：

- 对高风险工具可以直接加入黑名单
- 如果外部工具经常超时，可以适当调大 `timeoutMs`

## 13. 常见问题

### 14.1 改完 `config.yaml` 需要重启吗？

通常不需要。程序会监听配置文件变化并自动重载。

### 14.2 `provider` 和 `model` 要怎么对应？

- `provider` 是你在 `providers` 里定义的名字
- `model` 是该 provider 实际使用的模型名

例如：

```yaml
providers:
  myopenai:
    apiKey: sk-xxx
    apiBase: https://api.openai.com/v1

agent:
  defaults:
    provider: myopenai
    model: gpt-4o
```

### 14.3 可以不写 `memorySummary.provider` 和 `memoryFacts.provider` 吗？

可以。留空时会回退到 `agent.defaults.provider`。

### 14.4 `contextMode` 应该选哪个？

- 大多数聊天机器人：`channel`
- 每次对话严格隔离：`session`
- 只有很明确需要全局共享上下文时才考虑 `global`