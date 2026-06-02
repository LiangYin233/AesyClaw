---
name: aesyclaw-operations
description: 当用户询问或要求操作 AesyClaw（安装 Skill、编辑配置、管理 Provider/Channel/Role/Plugin/MCP、开关插件、查询命令）时使用。
---

# AesyClaw 操作指南

当用户询问 AesyClaw 的使用操作时，按下面的路径回答。

## 关键文件路径

| 用途       | 路径                                                                 |
| ---------- | -------------------------------------------------------------------- |
| 主配置     | `.aesyclaw/config.json`                                              |
| 角色定义   | `.aesyclaw/roles.json`                                               |
| 用户 Skill | `.aesyclaw/skills/`                                                  |
| 内置 Skill | `skills/`                                                            |
| 数据库     | `.aesyclaw/data/aesyclaw.db`                                         |
| 媒体缓存   | `.aesyclaw/media/`（含 `desktop/`、`onebot/`、`weixin/` 子频道媒体） |
| 工作区     | `.aesyclaw/workspace/`                                               |

## 安装第三方 Skill

1. 将用户要求安装的 Skill 的整个目录（即包含 SKILL.md 及附属文件的目录）放入 `.aesyclaw/skills/`
2. 在 `.aesyclaw/roles.json` 中，将 Skill 的 `name` 加入对应角色的 `skills` 数组（或设为 `["*"]` 启用所有）
3. 执行 `/skill reload` 让变更生效（角色配置变更由热重载自动生效，但 Skill 文件需要手动 reload）

## 管理 Provider

编辑 `.aesyclaw/config.json` 的 `providers` 段，key 为 provider 名称：

```json
"providers": {
  "my-provider": {
    "apiType": "openai-completions",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "sk-...",
    "models": {
      "model-id": {
        "contextWindow": 100000,
        "input": ["text", "image"],
        "extraBody": { "temperature": 0.7, "top_p": 0.9 }
      }
    }
  }
}
```

### Provider 级字段

| 字段      | 类型     | 必填 | 说明                                                                     |
| --------- | -------- | ---- | ------------------------------------------------------------------------ |
| `apiType` | `string` | 是   | 协议类型：`openai-completions`、`openai-responses`、`anthropic-messages` |
| `baseUrl` | `string` | 否   | API 地址                                                                 |
| `apiKey`  | `string` | 否   | API 密钥                                                                 |
| `models`  | `object` | 否   | 模型能力预设，key 为模型 ID                                              |

### Model 级字段（`models.<modelId>`）

| 字段            | 类型       | 说明                                                   |
| --------------- | ---------- | ------------------------------------------------------ |
| `contextWindow` | `number`   | 覆盖上下文窗口（token 数），默认 128000                |
| `input`         | `string[]` | 覆盖支持输入类型，如 `["text"]` 或 `["text", "image"]` |
| `extraBody`     | `object`   | 注入 API 请求体的额外字段（如 temperature、top_p 等）  |

模型引用格式：`<provider>/<modelId>`（如 `dmxapi/deepseek-v4-flash`）。

## 管理 Channel

编辑 `.aesyclaw/config.json` 的 `channels` 段，key 为频道名称：

```jsonc
"channels": {
  "onebot": { "enabled": true, "baseUrl": "ws://...", "token": "..." }
}
```

各频道所需的配置项（如 `baseUrl`、`token` 等）由扩展自身的 `config-schema.ts` 定义，可先用 `/plugin list` 查看已注册的频道列表，再参考对应扩展的文档补全配置。通过 `enabled: true/false` 控制开关，修改后热重载自动生效。

## 管理 Role

- **查看角色列表**：`/role list`
- **切换角色**：`/role switch <id>`
- **查看当前角色**：`/role info`
- **编辑角色**：直接修改 `.aesyclaw/roles.json`（支持热重载）

Role 的 `skills` 设为 `["*"]` 启用所有 Skill，或列出具体 Skill name。
每个 Role 的 `model` 字段使用 `<provider>/<modelId>` 格式（如 `openai/gpt-4o`），参见上方 Provider 管理说明。

## 管理 Plugin

- **查看插件**：`/plugin list`
- **启用插件**：`/plugin enable <name>`
- **禁用插件**：`/plugin disable <name>`

也可编辑 `.aesyclaw/config.json` 的 `plugins` 段。

## 管理 MCP

编辑 `.aesyclaw/config.json` 的 `mcp` 数组。支持三种 transport，各字段按 transport 类型决定是否必填：

### 所有字段

| 字段        | 类型       | 说明                                                           |
| ----------- | ---------- | -------------------------------------------------------------- |
| `name`      | `string`   | **必填**。MCP 服务器标识，tools 自动前缀为 `<name>_<toolName>` |
| `transport` | `string`   | **必填**。`stdio` / `sse` / `http`                             |
| `command`   | `string`   | stdio 必填，可执行路径（如 `node`、`python`）                  |
| `args`      | `string[]` | stdio 可选，传给 command 的参数                                |
| `env`       | `object`   | stdio 可选，注入的环境变量                                     |
| `url`       | `string`   | sse/http 必填，服务器 URL                                      |
| `enabled`   | `boolean`  | 是否启用，默认 `true`                                          |

### 按 transport 区分

```
stdio:  name + transport + command + [args] + [env] + [enabled]
sse:    name + transport + url + [enabled]
http:   name + transport + url + [enabled]
```

### 示例

```json
"mcp": [
  { "name": "local-fs", "transport": "stdio", "command": "node", "args": ["mcp-server/index.mjs"], "enabled": true },
  { "name": "web-search", "transport": "sse", "url": "https://mcp.example.com/sse", "enabled": true },
  { "name": "api-gw", "transport": "http", "url": "https://mcp.example.com/mcp", "enabled": false }
]
```

## 可用命令

| 命令                        | 说明                                            |
| --------------------------- | ----------------------------------------------- |
| `/help`                     | 查看所有命令                                    |
| `/btw <message>`            | 在当前会话发起一次独立提问（不记入历史）        |
| `/model <provider/modelId>` | 切换模型（如 `/model openai/gpt-4o`）           |
| `/clear [delete]`           | 清空会话历史；使用 `/clear delete` 删除当前会话 |
| `/compact`                  | 压缩会话上下文以减少 token 消耗                 |
| `/stop`                     | 终止当前正在进行的 Agent 处理                   |
| `/skill reload`             | 重新加载所有技能文件                            |
| `/role list`                | 列出角色                                        |
| `/role switch <id>`         | 切换角色                                        |
| `/role info`                | 查看当前角色                                    |
| `/plugin list`              | 列出插件                                        |
| `/plugin enable <name>`     | 启用插件                                        |
| `/plugin disable <name>`    | 禁用插件                                        |

## Web UI

默认地址 `http://<host>:<port>`，首次启动会自动生成 `server.authToken` 并打印在日志中（格式：`abcd...wxyz`）。
WebSocket 支持可视化管理配置、角色、会话、监控等。
