# RequestBuilder 模块

请求构建器模块，用于构建发送给不同 LLM 提供商的请求。

## 功能特性

- ✅ 支持多种 LLM 提供商（OpenAI、Anthropic）
- ✅ 支持标准请求和流式请求
- ✅ 集成消息转换器和工具转换器
- ✅ 支持自定义请求选项
- ✅ 提供请求验证功能
- ✅ 支持系统提示单独传递或放在消息数组

## 核心类型

### RequestOptions

请求选项配置，定义通用的请求参数：

```typescript
interface RequestOptions {
  temperature?: number;        // 温度参数 (0-2)
  maxTokens?: number;          // 最大生成 token 数
  topP?: number;              // Top-p 采样参数 (0-1)
  stopSequences?: string[];   // 停止序列
  frequencyPenalty?: number;  // 频率惩罚 (-2.0 到 2.0)
  presencePenalty?: number;   // 存在惩罚 (-2.0 到 2.0)
  stream?: boolean;           // 是否流式输出
  user?: string;              // 用户标识符
  seed?: number;              // 种子值
  responseFormat?: { type: 'text' | 'json_object' }; // 响应格式
  customParams?: Record<string, unknown>; // 自定义参数
}
```

### StandardRequest

标准请求联合类型：

```typescript
type StandardRequest =
  | { provider: LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion; request: OpenAIStandardRequest }
  | { provider: LLMProviderType.Anthropic; request: AnthropicStandardRequest };
```

### StreamRequest

流式请求联合类型：

```typescript
type StreamRequest =
  | { provider: LLMProviderType.OpenAIChat | LLMProviderType.OpenAICompletion; request: OpenAIStreamRequest }
  | { provider: LLMProviderType.Anthropic; request: AnthropicStreamRequest };
```

## 使用方法

### 1. 创建请求构建器

```typescript
import { RequestBuilder, LLMProviderType } from './builders';

const builder = new RequestBuilder({
  providerType: LLMProviderType.OpenAIChat,
  model: 'gpt-4o-mini',
  defaultOptions: {
    temperature: 0.7,
    maxTokens: 2048,
  },
});
```

### 2. 构建标准请求

```typescript
import { StandardMessage, MessageRole } from '../types';

const messages: StandardMessage[] = [
  {
    role: MessageRole.User,
    content: '你好，请介绍一下你自己',
  },
];

const request = builder.build({
  messages,
  systemPrompt: '你是一个友好的助手',
  options: {
    temperature: 0.8,
    maxTokens: 1024,
  },
});

console.log(request);
// 输出: { provider: 'openai-chat', request: { model: 'gpt-4o-mini', messages: [...], ... } }
```

### 3. 构建流式请求

```typescript
const streamRequest = builder.buildStream({
  messages,
  systemPrompt: '你是一位诗人',
  options: {
    temperature: 0.9,
  },
});

console.log(streamRequest);
// 输出: { provider: 'openai-chat', request: { model: 'gpt-4o-mini', messages: [...], stream: true, ... } }
```

### 4. 构建包含工具的请求

```typescript
import { ToolDefinition } from '../../../platform/tools/types';

const tools: ToolDefinition[] = [
  {
    name: 'get_weather',
    description: '获取指定城市的天气信息',
    parameters: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称',
        },
      },
      required: ['city'],
    },
  },
];

const request = builder.build({
  messages,
  tools,
  options: {
    temperature: 0.7,
  },
});
```

### 5. 验证请求参数

```typescript
const validation = builder.validate(messages, options);

if (!validation.valid) {
  console.error('请求验证失败:', validation.errors);
}

if (validation.warnings.length > 0) {
  console.warn('警告:', validation.warnings);
}
```

### 6. 合并请求选项

```typescript
const mergedOptions = builder.mergeOptions({
  temperature: 0.8,
  maxTokens: 1024,
  frequencyPenalty: 0.5,
});

console.log(mergedOptions);
// 输出合并后的选项，包含默认值和自定义值
```

## 提供商特定行为

### OpenAI

- 系统消息放在 `messages` 数组的第一个位置
- 工具使用 `tools` 字段，格式为 `{ type: 'function', function: { ... } }`
- 支持 `tool_choice` 参数控制工具选择策略
- 流式请求支持 `stream_options.include_usage` 获取 token 使用统计

### Anthropic

- 系统提示单独传递（不在 `messages` 数组中）
- 工具使用 `tools` 字段，格式为 `{ name, description, input_schema }`
- 必须设置 `max_tokens` 参数
- 工具结果作为 `user` 消息的 `content` block

## 高级用法

### 自定义参数

```typescript
const request = builder.build({
  messages,
  options: {
    responseFormat: { type: 'json_object' },
    seed: 42,
    customParams: {
      logit_bias: { '123': -100 },
    },
  },
});
```

### 包含工具调用的对话

```typescript
const messages: StandardMessage[] = [
  {
    role: MessageRole.User,
    content: '北京今天天气怎么样？',
  },
  {
    role: MessageRole.Assistant,
    content: '',
    toolCalls: [
      {
        id: 'call_123',
        name: 'get_weather',
        arguments: { city: '北京' },
      },
    ],
  },
  {
    role: MessageRole.Tool,
    content: JSON.stringify({ temperature: '25°C', weather: '晴天' }),
    toolCallId: 'call_123',
  },
  {
    role: MessageRole.Assistant,
    content: '北京今天天气很好，温度25°C，是个晴天。',
  },
];

const request = builder.build({ messages, tools });
```

## 错误处理

```typescript
try {
  const request = builder.build({
    messages: [], // 空消息数组
  });
} catch (error) {
  console.error('构建请求失败:', error.message);
  // 输出: "请求验证失败: 消息数组不能为空"
}
```

## 最佳实践

1. **设置默认选项**: 在创建构建器时设置合理的默认选项，避免每次构建时重复设置
2. **验证请求**: 在发送请求前先验证，避免因参数错误导致 API 调用失败
3. **使用类型安全**: 充分利用 TypeScript 的类型检查，确保请求参数的正确性
4. **合理使用工具**: 只在需要时传递工具定义，减少请求大小
5. **控制输出长度**: 根据实际需求设置 `maxTokens`，避免生成过长的响应

## 相关模块

- [MessageTransformer](../transformers/message-transformer.ts) - 消息转换器
- [ToolTransformer](../transformers/tool-transformer.ts) - 工具转换器
- [PromptContext](../prompt-context.ts) - 提示上下文
- [Adapters](../adapters) - LLM 适配器

## 示例代码

完整的使用示例请参考 [examples.ts](./examples.ts) 文件。
