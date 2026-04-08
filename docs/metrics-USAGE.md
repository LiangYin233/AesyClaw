# MetricsCollector 使用指南

## 概述

MetricsCollector 是一个用于收集、统计和分析 LLM 调用指标的模块。它可以跟踪请求数量、成功率、延迟、Token 使用和成本等关键指标。

## 核心功能

### 1. 请求指标记录
- 自动记录请求开始和结束时间
- 计算请求延迟
- 跟踪 Token 使用情况
- 记录成功/失败状态和错误信息

### 2. 成本计算
- 支持主流 LLM 模型的定价
- 自动计算预估成本
- 支持模糊匹配模型名称

### 3. 统计分析
- 总体统计（请求数、成功率、平均延迟等）
- 按提供商分组统计
- 按模型分组统计
- 错误聚合分析

## 快速开始

### 基本使用

```typescript
import { MetricsCollector, LLMProviderType } from './agent/llm/metrics/index.js';

// 创建指标收集器
const collector = new MetricsCollector({
  enabled: true,
  maxRequests: 10000,
  verbose: true
});

// 开始记录请求
const requestId = collector.startRequest(
  LLMProviderType.OpenAIChat,
  'gpt-4o',
  { chatId: 'chat-123', senderId: 'user-456' }
);

// 记录成功请求
collector.recordSuccess(requestId, {
  promptTokens: 100,
  completionTokens: 50,
  totalTokens: 150
});

// 获取统计报告
const report = collector.getMetricsReport();
console.log(`成功率: ${report.successRate}%`);
console.log(`预估成本: $${report.estimatedCost}`);
```

### 集成到现有适配器

```typescript
import { OpenAIChatAdapter } from './adapters/openai-chat-adapter.js';
import { createMetricsEnabledProvider, getGlobalMetricsCollector } from './metrics/index.js';

// 创建原始适配器
const adapter = new OpenAIChatAdapter({
  provider: LLMProviderType.OpenAIChat,
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY
});

// 包装为带指标收集的适配器
const metricsEnabledAdapter = createMetricsEnabledProvider(
  adapter,
  'gpt-4o',
  getGlobalMetricsCollector()
);

// 使用适配器（指标会自动收集）
const response = await metricsEnabledAdapter.generate(context);
```

## API 参考

### MetricsCollector

#### 构造函数

```typescript
constructor(config?: MetricsCollectorConfig)
```

配置选项：
- `enabled`: 是否启用指标收集（默认: true）
- `maxRequests`: 最大保存请求数量（默认: 10000）
- `verbose`: 是否记录详细日志（默认: false）

#### 核心方法

**startRequest(provider, model, metadata?)**
开始记录请求，返回请求 ID。

**recordSuccess(requestId, tokenUsage?, metadata?)**
记录成功请求。

**recordError(requestId, error, errorType?, metadata?)**
记录失败请求。

**recordRequest(metric)**
直接记录完整的请求指标。

**getMetricsReport(startTime?, endTime?)**
获取完整统计报告。

**getProviderMetrics(provider)**
获取指定提供商的统计指标。

**getModelMetrics(model)**
获取指定模型的统计指标。

**calculateCost(model, tokenUsage)**
计算请求成本。

**exportJSON()**
导出指标数据为 JSON 格式。

**printSummary()**
打印摘要报告到日志。

**clear()**
清除所有指标数据。

**clearBefore(before)**
清除指定时间之前的指标数据。

## 支持的模型定价

| 模型 | 输入价格 ($/1K tokens) | 输出价格 ($/1K tokens) |
|------|----------------------|----------------------|
| GPT-4o | 0.005 | 0.015 |
| GPT-4o-mini | 0.00015 | 0.0006 |
| GPT-4-turbo | 0.01 | 0.03 |
| GPT-3.5-turbo | 0.0005 | 0.0015 |
| Claude 3 Opus | 0.015 | 0.075 |
| Claude 3 Sonnet | 0.003 | 0.015 |
| Claude 3 Haiku | 0.00025 | 0.00125 |
| Claude 3.5 Sonnet | 0.003 | 0.015 |
| Claude 3.5 Haiku | 0.0008 | 0.004 |

## 统计报告示例

```typescript
const report = collector.getMetricsReport();

console.log('=== LLM 指标统计报告 ===');
console.log(`时间范围: ${report.timeRange.start} ~ ${report.timeRange.end}`);
console.log(`总请求数: ${report.totalRequests}`);
console.log(`成功率: ${report.successRate}%`);
console.log(`平均延迟: ${report.averageLatency}ms`);
console.log(`总 Token: ${report.totalTokens}`);
console.log(`预估成本: $${report.estimatedCost}`);

// 按提供商统计
for (const [provider, metrics] of report.providers) {
  console.log(`\n${provider}:`);
  console.log(`  请求数: ${metrics.totalRequests}`);
  console.log(`  成功率: ${metrics.successRate}%`);
  console.log(`  成本: $${metrics.estimatedCost}`);

  // 按模型统计
  for (const [model, modelMetrics] of metrics.models) {
    console.log(`  ${model}:`);
    console.log(`    平均延迟: ${modelMetrics.averageLatency}ms`);
    console.log(`    平均成本: $${modelMetrics.averageCostPerRequest}`);
  }
}

// 错误统计
for (const error of report.errors) {
  console.log(`\n错误: ${error.errorType}`);
  console.log(`  消息: ${error.errorMessage}`);
  console.log(`  次数: ${error.count}`);
}
```

## 最佳实践

### 1. 使用全局实例

```typescript
import { getGlobalMetricsCollector } from './metrics/index.js';

const collector = getGlobalMetricsCollector();
```

### 2. 定期清理旧数据

```typescript
// 清除 30 天前的数据
const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
collector.clearBefore(thirtyDaysAgo);
```

### 3. 监控关键指标

```typescript
const report = collector.getMetricsReport();

// 监控成功率
if (report.successRate < 95) {
  console.warn('成功率低于 95%，请检查系统健康状况');
}

// 监控平均延迟
if (report.averageLatency > 5000) {
  console.warn('平均延迟超过 5 秒，请优化性能');
}

// 监控成本
if (report.estimatedCost > 100) {
  console.warn('预估成本超过 $100，请关注使用情况');
}
```

### 4. 导出和分析数据

```typescript
// 导出 JSON 用于进一步分析
const jsonData = collector.exportJSON();
fs.writeFileSync('metrics-report.json', jsonData);

// 或发送到监控系统
await sendToMonitoringSystem(JSON.parse(jsonData));
```

## 文件结构

```
src/agent/llm/metrics/
├── metrics-collector.ts      # 核心指标收集器实现
├── integration.ts            # 与现有适配器的集成
├── examples.ts               # 使用示例
├── metrics-collector.test.ts # 单元测试
└── index.ts                  # 模块导出
```

## 类型定义

### RequestMetric
单次请求指标，包含请求 ID、提供商、模型、时间、延迟、Token 使用、成功状态等。

### MetricsReport
完整统计报告，包含总体指标、按提供商分组、按模型分组、错误统计等。

### ProviderMetrics
按提供商分组的指标统计。

### ModelMetrics
按模型分组的指标统计，包含最小/最大延迟、平均成本等详细统计。

### ErrorMetric
错误统计，包含错误类型、消息、出现次数、关联的提供商和模型。

## 注意事项

1. **性能影响**: 指标收集会带来轻微的性能开销，建议在生产环境中设置合理的 `maxRequests` 限制。

2. **内存使用**: 所有指标数据存储在内存中，长时间运行的应用应定期清理旧数据。

3. **成本计算**: 成本为预估值，基于官方定价，实际成本可能因折扣、套餐等因素有所不同。

4. **隐私保护**: 避免在 metadata 中记录敏感信息，如用户输入的完整内容。

## 许可证

MIT
