# 统一 LLM 客户端（UnifiedLLMClient）

统一的 LLM 调用接口，集成缓存、错误处理、指标收集等功能。

## 功能特性

- **统一接口**: 提供一致的 API 调用不同 LLM 提供商（OpenAI、Anthropic）
- **智能缓存**: 支持 TTL 过期和 LRU 淘汰策略，减少重复请求
- **错误处理**: 自动重试机制，支持指数退避和抖动
- **指标收集**: 收集请求延迟、Token 使用、成本等统计信息
- **流式输出**: 支持实时流式响应
- **批量处理**: 并发处理多个请求
- **事件系统**: 监听请求生命周期事件

## 快速开始

### 安装

```bash
npm install
```

### 基本使用

```typescript
import { UnifiedLLMClient, LLMProviderType, MessageRole } from './agent/llm';

// 创建客户端
const client = new UnifiedLLMClient({
  provider: LLMProviderType.OpenAIChat,
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  cacheEnabled: true,
});

// 发送请求
const response = await client.generate({
  messages: [
    { role: MessageRole.User, content: '你好！' }
  ],
  systemPrompt: '你是一个友好的助手。',
});

console.log(response.text);
console.log(response.tokenUsage);

// 销毁客户端
client.destroy();
```

## 核心功能

### 1. 标准调用（generate）

返回完整的响应结果。

```typescript
const response = await client.generate({
  messages: [{ role: MessageRole.User, content: '什么是 TypeScript？' }],
  systemPrompt: '你是一个技术专家。',
  tools: [
    {
      name: 'search',
      description: '搜索信息',
      parameters: { type: 'object', properties: { query: { type: 'string' } } }
    }
  ],
}, {
  temperature: 0.7,
  maxTokens: 2048,
});
```

### 2. 流式调用（generateStream）

实时返回 token。

```typescript
await client.generateStream(
  {
    messages: [{ role: MessageRole.User, content: '讲个故事' }],
  },
  {
    onToken: (text) => process.stdout.write(text),
    onComplete: (result) => {
      console.log('\n完成！');
      console.log('Token 使用:', result.tokenUsage);
    },
    onError: (error) => console.error('错误:', error),
  }
);
```

### 3. 批量调用（generateBatch）

并发处理多个请求。

```typescript
const results = await client.generateBatch([
  { id: '1', messages: [{ role: MessageRole.User, content: '1+1=?' }] },
  { id: '2', messages: [{ role: MessageRole.User, content: '2+2=?' }] },
  { id: '3', messages: [{ role: MessageRole.User, content: '3+3=?' }] },
], 2); // 并发数 2

results.forEach(result => {
  if (result.success) {
    console.log(`${result.id}: ${result.response?.text}`);
  }
});
```

## 配置选项

### UnifiedLLMClientConfig

```typescript
interface UnifiedLLMClientConfig {
  // 必需
  provider: LLMProviderType;      // 提供商类型
  model: string;                  // 模型名称

  // 可选
  apiKey?: string;                // API 密钥
  baseUrl?: string;               // API 基础地址
  timeout?: number;               // 超时时间（毫秒）
  cacheEnabled?: boolean;         // 是否启用缓存
  streamEnabled?: boolean;        // 是否启用流式
  retryPolicy?: Partial<RetryPolicy>;  // 重试策略
  cacheConfig?: CacheConfig;      // 缓存配置
  metricsConfig?: MetricsCollectorConfig; // 指标配置
  defaultOptions?: RequestOptions; // 默认请求选项
}
```

### UnifiedRequestOptions

```typescript
interface UnifiedRequestOptions extends RequestOptions {
  // 缓存相关
  cacheEnabled?: boolean;         // 是否启用缓存
  cacheTTL?: number;              // 缓存 TTL（毫秒）

  // 会话相关
  sessionId?: string;             // 会话 ID
  userId?: string;                // 用户 ID

  // 模型参数
  temperature?: number;           // 温度 (0-2)
  maxTokens?: number;             // 最大 token 数
  topP?: number;                  // Top-p (0-1)
  frequencyPenalty?: number;      // 频率惩罚 (-2 到 2)
  presencePenalty?: number;       // 存在惩罚 (-2 到 2)
  stopSequences?: string[];       // 停止序列

  // 其他
  user?: string;                  // 用户标识
  seed?: number;                  // 种子值
  responseFormat?: { type: 'text' | 'json_object' }; // 响应格式
  metadata?: Record<string, unknown>; // 额外元数据
}
```

## 事件系统

监听请求生命周期事件。

```typescript
// 请求开始
client.on(UnifiedClientEvent.REQUEST_START, (data) => {
  console.log('请求开始:', data.requestId);
});

// 请求完成
client.on(UnifiedClientEvent.REQUEST_COMPLETE, (data) => {
  console.log('请求完成:', data.latency, 'ms');
  console.log('Token 使用:', data.tokenUsage);
  console.log('预估成本:', data.estimatedCost);
});

// 缓存命中
client.on(UnifiedClientEvent.CACHE_HIT, (data) => {
  console.log('缓存命中:', data.cacheKey);
});

// 缓存未命中
client.on(UnifiedClientEvent.CACHE_MISS, (data) => {
  console.log('缓存未命中:', data.cacheKey);
});

// 请求错误
client.on(UnifiedClientEvent.REQUEST_ERROR, (data) => {
  console.error('请求失败:', data.errorType, data.errorMessage);
});
```

## 指标收集

获取详细的统计信息。

```typescript
// 获取指标报告
const metrics = client.getMetrics();

console.log('总请求数:', metrics.totalRequests);
console.log('成功率:', metrics.successRate, '%');
console.log('平均延迟:', metrics.averageLatency, 'ms');
console.log('总 Token:', metrics.totalTokens);
console.log('预估成本:', metrics.estimatedCost);

// 按提供商查看
for (const [provider, providerMetrics] of metrics.providers) {
  console.log(`提供商: ${provider}`);
  console.log(`  请求数: ${providerMetrics.totalRequests}`);
  console.log(`  成功率: ${providerMetrics.successRate}%`);

  // 按模型查看
  for (const [model, modelMetrics] of providerMetrics.models) {
    console.log(`  模型: ${model}`);
    console.log(`    平均延迟: ${modelMetrics.averageLatency}ms`);
    console.log(`    平均成本: $${modelMetrics.averageCostPerRequest}`);
  }
}
```

## 缓存管理

```typescript
// 查看缓存统计
const cacheStats = client.getCacheStats();
console.log('缓存大小:', cacheStats.size);
console.log('命中率:', cacheStats.hitRate);

// 清除缓存
client.clearCache();
```

## 错误处理

自动重试机制。

```typescript
const client = new UnifiedLLMClient({
  provider: LLMProviderType.OpenAIChat,
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
  retryPolicy: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    enableJitter: true,
  },
});

try {
  const response = await client.generate({
    messages: [{ role: MessageRole.User, content: '你好！' }],
  });
} catch (error: any) {
  console.error('错误类型:', error.errorInfo?.type);
  console.error('是否可重试:', error.errorInfo?.retryable);
  console.error('重试次数:', error.retryStats?.retryCount);
}
```

## 支持的提供商

### OpenAI

```typescript
const client = new UnifiedLLMClient({
  provider: LLMProviderType.OpenAIChat,
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
});
```

### Anthropic

```typescript
const client = new UnifiedLLMClient({
  provider: LLMProviderType.Anthropic,
  model: 'claude-3-5-sonnet-20241022',
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

## 工具调用

支持 Function Calling。

```typescript
const tools = [
  {
    name: 'get_weather',
    description: '获取天气信息',
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称' },
      },
      required: ['city'],
    },
  },
];

const response = await client.generate({
  messages: [{ role: MessageRole.User, content: '北京天气怎么样？' }],
  tools,
});

if (response.toolCalls.length > 0) {
  response.toolCalls.forEach(toolCall => {
    console.log(`工具: ${toolCall.name}`);
    console.log(`参数:`, toolCall.arguments);
  });
}
```

## 最佳实践

### 1. 使用缓存

对于重复的请求，启用缓存可以显著减少 API 调用次数和成本。

```typescript
const client = new UnifiedLLMClient({
  // ...
  cacheEnabled: true,
  cacheConfig: {
    defaultTTL: 60 * 60 * 1000, // 1 小时
    maxSize: 1000,
  },
});
```

### 2. 监控指标

定期查看指标以优化性能和成本。

```typescript
setInterval(() => {
  const metrics = client.getMetrics();
  console.log('总成本:', metrics.estimatedCost);
  console.log('平均延迟:', metrics.averageLatency);
}, 60000);
```

### 3. 合理设置重试策略

根据应用场景调整重试策略。

```typescript
retryPolicy: {
  maxRetries: 3,          // 最大重试次数
  initialDelay: 1000,     // 初始延迟 1 秒
  maxDelay: 30000,        // 最大延迟 30 秒
  backoffMultiplier: 2,   // 指数退避倍数
  enableJitter: true,     // 启用抖动避免重试风暴
}
```

### 4. 使用事件系统

通过事件系统实现日志记录和监控。

```typescript
client.on(UnifiedClientEvent.REQUEST_COMPLETE, (data) => {
  // 记录到日志系统
  logger.info({
    requestId: data.requestId,
    latency: data.latency,
    tokens: data.tokenUsage,
    cost: data.estimatedCost,
  });
});
```

### 5. 及时销毁客户端

使用完毕后及时销毁客户端释放资源。

```typescript
// 使用完毕
client.destroy();
```

## API 参考

详细的 API 文档请参考：

- [UnifiedLLMClient](./unified-client.ts) - 主类实现
- [示例代码](./unified-client.example.ts) - 完整使用示例

## 许可证

MIT
