# 错误处理与日志系统优化计划（简化版）

## 概述

本计划旨在现代化 AesyClaw 的错误处理和日志系统，同时保持现有行为不变。优化将分为 2 个阶段，每个阶段独立可交付。

**目标：**
- 统一错误处理模式
- 支持日志级别运行时更改（热重载）
- 保持向后兼容

**原则：**
- 渐进式增强，不破坏现有功能
- 使用现代化的 TypeScript 模式
- 零依赖
- 性能优先

---

## 阶段 1：错误处理标准化（3-4 天）

### 1.1 扩展错误类型系统

**目标：** 完善错误类型，覆盖所有业务场景

**新增错误类：**

```typescript
// src/utils/errors.ts

/**
 * MCP 相关错误
 */
export class MCPError extends AppError {
  constructor(serverName: string, message: string, details?: any) {
    super(`MCP Server "${serverName}": ${message}`, 'MCP_ERROR', 500, details);
    this.name = 'MCPError';
  }
}

/**
 * Channel 相关错误
 */
export class ChannelError extends AppError {
  constructor(channelName: string, message: string, details?: any) {
    super(`Channel "${channelName}": ${message}`, 'CHANNEL_ERROR', 500, details);
    this.name = 'ChannelError';
  }
}

/**
 * Session 相关错误
 */
export class SessionError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'SESSION_ERROR', 500, details);
    this.name = 'SessionError';
  }
}

/**
 * LLM Provider 错误
 */
export class ProviderError extends AppError {
  constructor(providerName: string, message: string, details?: any) {
    super(`Provider "${providerName}": ${message}`, 'PROVIDER_ERROR', 500, details);
    this.name = 'ProviderError';
  }
}

/**
 * Timeout 错误
 */
export class TimeoutError extends AppError {
  constructor(operation: string, timeout: number) {
    super(`Operation "${operation}" timed out after ${timeout}ms`, 'TIMEOUT_ERROR', 408);
    this.name = 'TimeoutError';
  }
}

/**
 * Rate Limit 错误
 */
export class RateLimitError extends AppError {
  constructor(resource: string, retryAfter?: number) {
    super(`Rate limit exceeded for ${resource}`, 'RATE_LIMIT_ERROR', 429, { retryAfter });
    this.name = 'RateLimitError';
  }
}
```

### 1.2 错误上下文增强

**新增功能：**

```typescript
// src/utils/errors.ts

/**
 * Error Context - 携带额外上下文信息
 */
export interface ErrorContext {
  operation?: string;      // 操作名称
  component?: string;      // 组件名称
  userId?: string;         // 用户 ID
  sessionId?: string;      // 会话 ID
  timestamp?: Date;        // 时间戳
  metadata?: Record<string, any>;  // 额外元数据
}

/**
 * 增强的 AppError，支持上下文
 */
export class AppError extends Error {
  public readonly context: ErrorContext;

  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any,
    context?: ErrorContext
  ) {
    super(message);
    this.name = 'AppError';
    this.context = {
      timestamp: new Date(),
      ...context
    };
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      context: this.context,
      ...(this.details && { details: this.details })
    };
  }
}
```

### 1.3 错误处理中间件

**新建文件：** `src/utils/errorHandler.ts`

```typescript
/**
 * Error Handler Middleware
 *
 * 提供统一的错误处理逻辑
 */

import { Logger } from '../logger/index.js';
import { AppError, normalizeError, getErrorStack } from './errors.js';

export interface ErrorHandlerOptions {
  logger?: Logger;
  includeStack?: boolean;
  onError?: (error: Error) => void | Promise<void>;
}

export class ErrorHandler {
  constructor(private options: ErrorHandlerOptions = {}) {}

  /**
   * 处理错误并记录日志
   */
  async handle(error: unknown, context?: string): Promise<void> {
    const logger = this.options.logger;
    const message = normalizeError(error);
    const stack = this.options.includeStack ? getErrorStack(error) : undefined;

    // 记录日志
    if (logger) {
      if (error instanceof AppError) {
        logger.error(`[${context || 'Unknown'}] ${error.code}: ${message}`, {
          code: error.code,
          statusCode: error.statusCode,
          context: error.context,
          details: error.details,
          stack
        });
      } else {
        logger.error(`[${context || 'Unknown'}] ${message}`, { stack });
      }
    }

    // 调用自定义错误处理器
    if (this.options.onError && error instanceof Error) {
      try {
        await this.options.onError(error);
      } catch (handlerError) {
        logger?.error('Error in error handler:', handlerError);
      }
    }
  }

  /**
   * 包装异步函数，自动处理错误
   */
  wrap<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    context?: string
  ): T {
    return (async (...args: any[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        await this.handle(error, context);
        throw error;
      }
    }) as T;
  }
}

/**
 * 全局错误处理器实例
 */
export const globalErrorHandler = new ErrorHandler({
  includeStack: process.env.NODE_ENV !== 'production'
});
```

### 1.4 应用错误处理到现有模块

**修改文件：**
- `src/agent/AgentLoop.ts`
- `src/plugins/PluginManager.ts`
- `src/api/server.ts`
- `src/channels/OneBotChannel.ts`
- `src/mcp/MCPClient.ts`

**示例（AgentLoop.ts）：**

```typescript
// 替换现有的 catch 块
- catch (error: unknown) {
-   const message = error instanceof Error ? error.message : String(error);
-   log.error('Tool execution error:', message);
- }

+ catch (error: unknown) {
+   if (error instanceof Error) {
+     throw new ToolError(toolName, error.message, { params, originalError: error });
+   }
+   throw new ToolError(toolName, String(error), { params });
+ }
```

### 1.5 验证标准

- ✅ 所有模块使用统一的错误类
- ✅ 错误信息包含足够的上下文
- ✅ 错误日志格式一致
- ✅ 现有功能不受影响
- ✅ TypeScript 编译通过，无类型错误

---

## 阶段 2：日志级别热重载（1 天）

### 2.1 添加日志配置更新方法

**目标：** 支持运行时更改日志级别，无需重启服务

**修改文件：** `src/logger/index.ts`

```typescript
export class Logger {
  // ... 现有代码

  /**
   * 更新日志级别（热重载）
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * 获取当前配置
   */
  getConfig(): { level: LogLevel; prefix: string; showTimestamp: boolean; useColors: boolean } {
    return {
      level: this.level,
      prefix: this.prefix,
      showTimestamp: this.showTimestamp,
      useColors: this.useColors
    };
  }
}
```

**说明：** `setLevel` 方法已存在，只需添加 `getLevel` 和 `getConfig` 方法。

### 2.2 添加 API 端点

**修改文件：** `src/api/server.ts`

```typescript
// 获取日志配置
this.app.get('/api/logs/config', (req, res) => {
  res.json(logger.getConfig());
});

// 更新日志级别（热重载）
this.app.post('/api/logs/level', async (req, res) => {
  try {
    const { level } = req.body;

    // 验证日志级别
    const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    if (!level || !validLevels.includes(level)) {
      return res.status(400).json({
        error: `Invalid log level. Must be one of: ${validLevels.join(', ')}`
      });
    }

    // 更新日志级别
    logger.setLevel(level);

    res.json({
      success: true,
      level: logger.getLevel()
    });
  } catch (error) {
    res.status(400).json(createErrorResponse(error));
  }
});
```

### 2.3 验证标准

- ✅ 日志级别可通过 API 动态更改
- ✅ 更改立即生效，无需重启
- ✅ 现有日志行为不受影响
- ✅ API 端点正常工作

---

## 阶段 3：性能指标监控（2-3 天）

### 3.1 创建指标收集器

**目标：** 收集关键性能指标，便于监控和分析

**新建文件：** `src/logger/Metrics.ts`

```typescript
/**
 * Performance Metrics Collector
 *
 * 收集性能指标，用于监控和分析
 */

export interface Metric {
  name: string;
  value: number;
  unit: 'ms' | 'count' | 'bytes';
  timestamp: Date;
  tags?: Record<string, string>;
}

export interface MetricStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export class MetricsCollector {
  private metrics: Metric[] = [];
  private readonly maxMetrics: number;

  constructor(maxMetrics = 10000) {
    this.maxMetrics = maxMetrics;
  }

  /**
   * 记录指标
   */
  record(name: string, value: number, unit: Metric['unit'], tags?: Record<string, string>): void {
    this.metrics.push({
      name,
      value,
      unit,
      timestamp: new Date(),
      tags
    });

    // 限制内存使用，保留最近的指标
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  /**
   * 计时器 - 返回结束函数
   */
  timer(name: string, tags?: Record<string, string>): () => void {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.record(name, duration, 'ms', tags);
    };
  }

  /**
   * 获取指标统计（包含百分位数）
   */
  getStats(name: string, timeWindow?: number): MetricStats | null {
    let filtered = this.metrics.filter(m => m.name === name);

    // 时间窗口过滤（毫秒）
    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      filtered = filtered.filter(m => m.timestamp.getTime() >= cutoff);
    }

    if (filtered.length === 0) return null;

    const values = filtered.map(m => m.value).sort((a, b) => a - b);
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count: values.length,
      avg: sum / values.length,
      min: values[0],
      max: values[values.length - 1],
      p50: this.percentile(values, 0.5),
      p95: this.percentile(values, 0.95),
      p99: this.percentile(values, 0.99)
    };
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedValues: number[], p: number): number {
    const index = Math.ceil(sortedValues.length * p) - 1;
    return sortedValues[Math.max(0, index)];
  }

  /**
   * 获取所有指标名称
   */
  getMetricNames(): string[] {
    const names = new Set(this.metrics.map(m => m.name));
    return Array.from(names);
  }

  /**
   * 导出指标（用于外部分析）
   */
  export(name?: string, timeWindow?: number): Metric[] {
    let result = this.metrics;

    if (name) {
      result = result.filter(m => m.name === name);
    }

    if (timeWindow) {
      const cutoff = Date.now() - timeWindow;
      result = result.filter(m => m.timestamp.getTime() >= cutoff);
    }

    return [...result];
  }

  /**
   * 清空指标
   */
  clear(name?: string): void {
    if (name) {
      this.metrics = this.metrics.filter(m => m.name !== name);
    } else {
      this.metrics = [];
    }
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage(): { count: number; maxCount: number; usage: string } {
    return {
      count: this.metrics.length,
      maxCount: this.maxMetrics,
      usage: `${((this.metrics.length / this.maxMetrics) * 100).toFixed(1)}%`
    };
  }
}

/**
 * 全局指标收集器
 */
export const metrics = new MetricsCollector();
```

### 3.2 集成到核心模块

**修改文件：** `src/agent/AgentLoop.ts`

```typescript
import { metrics } from '../logger/Metrics.js';

export class AgentLoop {
  // ... 现有代码

  async processMessage(msg: InboundMessage): Promise<AgentResponse> {
    const endTimer = metrics.timer('agent.process_message', {
      channel: msg.channel,
      sessionKey: msg.sessionKey || 'unknown'
    });

    try {
      // ... 现有逻辑

      // 记录消息处理成功
      metrics.record('agent.message_count', 1, 'count', { status: 'success' });

      return response;
    } catch (error) {
      // 记录消息处理失败
      metrics.record('agent.message_count', 1, 'count', { status: 'error' });
      throw error;
    } finally {
      endTimer();
    }
  }

  private async executeToolCall(toolCall: ToolCall): Promise<string> {
    const endTimer = metrics.timer('agent.tool_execution', {
      tool: toolCall.name
    });

    try {
      const result = await this.toolRegistry.execute(toolCall.name, toolCall.arguments);
      metrics.record('agent.tool_call_count', 1, 'count', {
        tool: toolCall.name,
        status: 'success'
      });
      return result;
    } catch (error) {
      metrics.record('agent.tool_call_count', 1, 'count', {
        tool: toolCall.name,
        status: 'error'
      });
      throw error;
    } finally {
      endTimer();
    }
  }
}
```

**修改文件：** `src/tools/ToolRegistry.ts`

```typescript
import { metrics } from '../logger/Metrics.js';

export class ToolRegistry {
  // ... 现有代码

  async execute(name: string, params: any): Promise<string> {
    const endTimer = metrics.timer('tool.execution_time', { tool: name });

    try {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Tool not found: ${name}`);
      }

      const result = await tool.execute(params);

      // 记录工具调用成功
      metrics.record('tool.call_count', 1, 'count', {
        tool: name,
        status: 'success'
      });

      return result;
    } catch (error) {
      // 记录工具调用失败
      metrics.record('tool.call_count', 1, 'count', {
        tool: name,
        status: 'error'
      });
      throw error;
    } finally {
      endTimer();
    }
  }
}
```

**修改文件：** `src/plugins/PluginManager.ts`

```typescript
import { metrics } from '../logger/Metrics.js';

export class PluginManager {
  // ... 现有代码

  async applyOnMessage(msg: InboundMessage): Promise<InboundMessage | null> {
    const endTimer = metrics.timer('plugin.hook_execution', { hook: 'onMessage' });

    try {
      const pipeline = new HookPipeline<InboundMessage>(
        Array.from(this.plugins.values()),
        'onMessage'
      );
      const result = await pipeline.execute(msg);

      metrics.record('plugin.hook_count', 1, 'count', {
        hook: 'onMessage',
        status: 'success'
      });

      return result;
    } catch (error) {
      metrics.record('plugin.hook_count', 1, 'count', {
        hook: 'onMessage',
        status: 'error'
      });
      throw error;
    } finally {
      endTimer();
    }
  }
}
```

### 3.3 添加 API 端点

**修改文件：** `src/api/server.ts`

```typescript
import { metrics } from '../logger/Metrics.js';
import type { LogLevel } from '../logger/index.js';

// ... 现有代码

// 获取所有指标名称
this.app.get('/api/metrics/names', (req, res) => {
  res.json({
    names: metrics.getMetricNames()
  });
});

// 获取指标统计
this.app.get('/api/metrics/stats/:name', (req, res) => {
  const { name } = req.params;
  const { timeWindow } = req.query;

  const window = timeWindow ? parseInt(timeWindow as string) : undefined;
  const stats = metrics.getStats(name, window);

  if (!stats) {
    return res.status(404).json({
      error: `Metric "${name}" not found or no data available`
    });
  }

  res.json(stats);
});

// 导出原始指标数据
this.app.get('/api/metrics/export', (req, res) => {
  const { name, timeWindow } = req.query;

  const window = timeWindow ? parseInt(timeWindow as string) : undefined;
  const data = metrics.export(name as string | undefined, window);

  res.json({
    count: data.length,
    metrics: data
  });
});

// 清空指标
this.app.post('/api/metrics/clear', (req, res) => {
  const { name } = req.body;
  metrics.clear(name);

  res.json({
    success: true,
    message: name ? `Cleared metrics for "${name}"` : 'Cleared all metrics'
  });
});

// 获取内存使用情况
this.app.get('/api/metrics/memory', (req, res) => {
  res.json(metrics.getMemoryUsage());
});

// 获取系统概览（常用指标）
this.app.get('/api/metrics/overview', (req, res) => {
  const timeWindow = 60000; // 最近 1 分钟

  const overview = {
    agent: {
      processMessage: metrics.getStats('agent.process_message', timeWindow),
      messageCount: metrics.getStats('agent.message_count', timeWindow),
      toolExecution: metrics.getStats('agent.tool_execution', timeWindow)
    },
    tools: {
      executionTime: metrics.getStats('tool.execution_time', timeWindow),
      callCount: metrics.getStats('tool.call_count', timeWindow)
    },
    plugins: {
      hookExecution: metrics.getStats('plugin.hook_execution', timeWindow),
      hookCount: metrics.getStats('plugin.hook_count', timeWindow)
    },
    memory: metrics.getMemoryUsage()
  };

  res.json(overview);
});
```

### 3.4 验证标准

- ✅ 指标正确收集（时间、计数）
- ✅ 统计计算准确（平均值、百分位数）
- ✅ API 端点正常工作
- ✅ 内存使用受控（不超过限制）
- ✅ 性能影响可接受（< 2% CPU 开销）

---

## 配置示例

### config.yaml

```yaml
log:
  level: info                    # debug | info | warn | error
```

**说明：** 配置文件中只需要 `level` 字段，其他配置保持默认值。

---

## 实施顺序

### 阶段 1（3-4 天）

**Day 1：**
1. 扩展错误类型（1.1）
2. 错误上下文增强（1.2）
3. 单元测试

**Day 2：**
4. 错误处理中间件（1.3）
5. 应用到 AgentLoop 和 PluginManager（1.4）
6. 集成测试

**Day 3：**
7. 应用到其他模块（API、Channel、MCP）（1.4）
8. 回归测试

**Day 4：**
9. 文档更新
10. Code Review
11. 合并到主分支

### 阶段 2（1 天）

**Day 1：**
1. 添加 `getLevel()` 和 `getConfig()` 方法（2.1）
2. 添加 API 端点（2.2）
3. 测试日志级别热重载
4. 文档更新

### 阶段 3（2-3 天）

**Day 1：**
1. 创建指标收集器（3.1）
2. 单元测试（统计计算、百分位数）

**Day 2：**
3. 集成到核心模块（3.2）
   - AgentLoop
   - ToolRegistry
   - PluginManager
4. 集成测试

**Day 3：**
5. 添加 API 端点（3.3）
6. 性能测试（确保开销 < 2%）
7. 文档更新
8. Code Review
9. 合并到主分支

---

## 向后兼容性

### 保持现有行为

1. **默认配置不变**：
   - 默认日志级别：`info`
   - 默认格式：`text`（彩色控制台输出）
   - 默认不输出到文件

2. **API 兼容**：
   - 现有的 `logger.debug/info/warn/error` 方法保持不变
   - 现有的错误处理代码继续工作

3. **渐进式增强**：
   - 新功能通过配置启用
   - 不配置则使用默认行为

### 迁移路径

**现有代码无需修改即可工作**

**可选升级：**

```typescript
// 旧代码（继续工作）
catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  log.error('Error:', message);
}

// 新代码（推荐）
catch (error: unknown) {
  throw new ToolError(toolName, normalizeError(error), { params });
}
```

---

## 性能影响

### 预期影响

- **日志级别热重载**：无性能影响，仅修改内存中的变量
- **API 端点**：影响可忽略（仅在调用时执行）
- **指标收集**：
  - CPU 开销：< 2%（每次记录约 0.01ms）
  - 内存占用：< 5MB（10000 条指标）
  - 无阻塞操作，不影响主流程

### 优化措施

1. **内存限制**：指标数组限制大小（默认 10000），自动清理旧数据
2. **轻量级操作**：仅记录必要信息，避免复杂计算
3. **延迟计算**：统计计算仅在查询时执行
4. **可配置**：可通过环境变量禁用指标收集

---

## 测试策略

### 单元测试

- 错误类型创建和序列化
- 日志格式化（text/json）
- 文件轮转逻辑
- 指标统计计算

### 集成测试

- 错误在各模块间传播
- 日志配置热重载
- 文件写入和轮转
- API 端点功能

### 性能测试

- 日志吞吐量（messages/sec）
- 内存使用（长时间运行）
- CPU 开销（不同日志级别）

---

## 风险评估

### 低风险

- ✅ 新增功能不影响现有行为
- ✅ 现有代码无需修改
- ✅ 简单易测试

### 回滚计划

- Git revert 到优化前版本
- 重启服务（如果需要）

---

## 预期成果

完成后，AesyClaw 将具备：

- ✅ **统一的错误处理**：所有模块使用标准错误类
- ✅ **日志级别热重载**：无需重启即可调整日志级别
- ✅ **性能指标监控**：内置 metrics 收集，支持百分位数统计
- ✅ **可观测性提升**：完整的错误追踪、性能数据和上下文信息

**质量提升：**
- 错误信息更清晰，包含完整上下文
- 日志级别可动态调整，便于调试
- 性能瓶颈可量化，便于优化

**开发体验提升：**
- 错误类型明确，IDE 自动补全
- 日志级别可通过 API 调整，无需重启服务
- 性能数据可视化，问题定位更快

**监控能力：**
- 消息处理时间（平均值、P95、P99）
- 工具调用次数和耗时
- 插件 Hook 执行性能
- 成功/失败率统计
