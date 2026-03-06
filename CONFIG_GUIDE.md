# 配置文件完整示例

## config.yaml

```yaml
# 服务器配置
server:
  host: 0.0.0.0
  port: 8080
  apiPort: 3000
  webuiPort: 5173

# Agent 配置
agent:
  defaults:
    model: gpt-4
    provider: openai
    maxToolIterations: 10
    memoryWindow: 20
    contextMode: session

# 日志配置
log:
  level: info              # debug | info | warn | error

# 性能指标配置
metrics:
  enabled: true            # 是否启用指标收集
  maxMetrics: 10000        # 最大指标数量
  collectAgent: true       # 收集 Agent 指标
  collectTools: true       # 收集工具指标
  collectPlugins: true     # 收集插件指标

# 频道配置
channels:
  onebot:
    enabled: true
    url: ws://localhost:8081
    token: your_token_here

# LLM 提供商配置
providers:
  openai:
    apiKey: sk-xxx
    baseURL: https://api.openai.com/v1

  minimax:
    apiKey: your_minimax_key
    groupId: your_group_id

# MCP 服务器配置
mcp:
  filesystem:
    command: npx
    args:
      - -y
      - @modelcontextprotocol/server-filesystem
      - /path/to/allowed/directory

# 插件配置
plugins:
  example-plugin:
    enabled: true
    option1: value1

# Skills 配置
skills:
  skill-name:
    enabled: true
```

## 配置说明

### 日志配置 (log)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `level` | string | `info` | 日志级别：debug, info, warn, error |

**说明：** 日志始终显示时间戳和使用颜色输出。

**运行时更改：**
- 通过 API：`POST /api/logs/level`
- 通过配置文件：修改 `log.level` 并重启服务

### 性能指标配置 (metrics)

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用指标收集 |
| `maxMetrics` | number | `10000` | 最大保留指标数量 |
| `collectAgent` | boolean | `true` | 收集 Agent 性能指标 |
| `collectTools` | boolean | `true` | 收集工具执行指标 |
| `collectPlugins` | boolean | `true` | 收集插件 Hook 指标 |

**运行时更改：**
- 通过 API：`POST /api/metrics/config`
- 通过配置文件：修改 `metrics` 部分并重启服务

**注意：** `maxMetrics` 只能在启动时设置，运行时无法更改。

## 配置优先级

1. **启动时配置**：从 `config.yaml` 读取
2. **运行时配置**：通过 API 动态更改（仅部分配置支持）

## 配置与 API 对应关系

| 配置项 | API 端点 | 支持运行时更改 |
|--------|----------|----------------|
| `log.level` | `POST /api/logs/level` | ✅ |
| `metrics.enabled` | `POST /api/metrics/config` | ✅ |
| `metrics.maxMetrics` | - | ❌ (需重启) |
| `metrics.collectAgent` | - | ⚠️ (计划中) |
| `metrics.collectTools` | - | ⚠️ (计划中) |
| `metrics.collectPlugins` | - | ⚠️ (计划中) |

## 最佳实践

### 开发环境

```yaml
log:
  level: debug

metrics:
  enabled: true
  maxMetrics: 5000
```

### 生产环境

```yaml
log:
  level: info

metrics:
  enabled: true
  maxMetrics: 20000
```

### 性能优先环境

```yaml
log:
  level: warn

metrics:
  enabled: false  # 禁用指标收集以获得最佳性能
```

## 配置验证

启动时会自动验证配置，如果配置有误会输出错误信息：

```bash
npm start
```

查看日志输出：
```
[AesyClaw] Metrics collection: enabled
[AesyClaw] Metrics max size: 10000
[AesyClaw] Initializing services with DI container...
```

## 动态配置示例

### 通过 API 更改日志级别

```bash
# 切换到 debug 模式
curl -X POST http://localhost:3000/api/logs/level \
  -H "Content-Type: application/json" \
  -d '{"level": "debug"}'

# 切换回 info 模式
curl -X POST http://localhost:3000/api/logs/level \
  -H "Content-Type: application/json" \
  -d '{"level": "info"}'
```

### 通过 API 控制指标收集

```bash
# 禁用指标收集
curl -X POST http://localhost:3000/api/metrics/config \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'

# 启用指标收集
curl -X POST http://localhost:3000/api/metrics/config \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# 查看当前配置
curl http://localhost:3000/api/metrics/config
```

响应示例：
```json
{
  "enabled": true,
  "maxMetrics": 10000,
  "currentCount": 125
}
```

## 环境变量支持

部分配置支持通过环境变量覆盖：

```bash
# 设置日志级别
export LOG_LEVEL=debug

# 禁用指标收集
export METRICS_ENABLED=false

# 启动服务
npm start
```

**注意：** 环境变量优先级高于配置文件。
