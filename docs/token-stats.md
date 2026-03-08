# Token 统计功能

## 功能说明

系统现在会自动统计和记录所有 LLM API 调用的 token 使用情况。

## 日志输出

每次 LLM 调用都会输出 token 使用日志（info 级别）：

```
[Provider] Token usage: prompt=150, completion=80, total=230
```

## 实时监控（Metrics）

Token 使用会实时记录到 metrics 系统，可通过 API 查询：

- `llm.tokens.prompt` - prompt tokens 使用量
- `llm.tokens.completion` - completion tokens 使用量
- `llm.tokens.total` - 总 token 使用量

每个指标都带有 `source` 标签（user/cron），可用于区分不同来源的请求。

### 查询 Metrics API

```bash
# 获取所有指标名称
curl http://localhost:3000/api/metrics/names

# 获取 token 统计（最近所有数据）
curl http://localhost:3000/api/metrics/stats/llm.tokens.total

# 获取最近 1 小时的统计（timeWindow 单位：毫秒）
curl "http://localhost:3000/api/metrics/stats/llm.tokens.total?timeWindow=3600000"

# 导出原始数据
curl http://localhost:3000/api/metrics/export
```

## 累计统计（持久化）

系统会自动累计所有 token 使用，并持久化到 `token-stats.json` 文件：

```json
{
  "promptTokens": 15000,
  "completionTokens": 8000,
  "totalTokens": 23000,
  "requestCount": 150,
  "lastUpdated": "2026-03-08T10:30:00.000Z"
}
```

### 查询累计统计 API

```bash
# 获取累计统计
curl http://localhost:3000/api/tokens/stats

# 重置统计（需要 POST）
curl -X POST http://localhost:3000/api/tokens/reset
```

## 数据说明

- **Metrics 数据**：保存在内存中，默认最多 10000 条记录，用于实时监控和短期分析
- **累计统计**：持久化到文件，记录从启动以来的所有累计数据，每 30 秒自动保存一次
