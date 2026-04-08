/**
 * LLM 指标收集器模块
 * 用于收集、统计和分析 LLM 调用的各项指标
 */

import { randomUUID } from 'crypto';
import { TokenUsage, LLMProviderType } from '../types.js';
import { logger } from '../../../platform/observability/logger.js';

/**
 * 模型定价信息（每 1K tokens, USD）
 */
export interface ModelPricing {
  prompt: number;      // 输入 token 价格（每 1K tokens）
  completion: number;  // 输出 token 价格（每 1K tokens）
}

/**
 * 主流模型定价表
 * 价格单位：美元/1K tokens
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI GPT-4 系列
  'gpt-4o': { prompt: 0.005, completion: 0.015 },
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'gpt-4': { prompt: 0.03, completion: 0.06 },
  'gpt-4-32k': { prompt: 0.06, completion: 0.12 },
  'gpt-3.5-turbo': { prompt: 0.0005, completion: 0.0015 },

  // Anthropic Claude 系列
  'claude-3-opus': { prompt: 0.015, completion: 0.075 },
  'claude-3-sonnet': { prompt: 0.003, completion: 0.015 },
  'claude-3-haiku': { prompt: 0.00025, completion: 0.00125 },
  'claude-3-5-sonnet': { prompt: 0.003, completion: 0.015 },
  'claude-3-5-haiku': { prompt: 0.0008, completion: 0.004 },

  // 其他模型
  'deepseek-chat': { prompt: 0.0001, completion: 0.0002 },
  'deepseek-coder': { prompt: 0.0001, completion: 0.0002 },
};

/**
 * 单次请求指标
 */
export interface RequestMetric {
  /** 请求唯一标识 */
  requestId: string;
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 模型名称 */
  model: string;
  /** 请求开始时间（ISO 字符串） */
  startTime: string;
  /** 请求结束时间（ISO 字符串） */
  endTime?: string;
  /** 请求延迟（毫秒） */
  latency?: number;
  /** Token 使用情况 */
  tokenUsage?: TokenUsage;
  /** 请求是否成功 */
  success: boolean;
  /** 错误信息（失败时） */
  error?: string;
  /** 错误类型（失败时） */
  errorType?: string;
  /** 预估成本（美元） */
  estimatedCost?: number;
  /** 会话 ID（可选） */
  sessionId?: string;
  /** 用户 ID（可选） */
  userId?: string;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 错误统计指标
 */
export interface ErrorMetric {
  /** 错误类型 */
  errorType: string;
  /** 错误消息 */
  errorMessage: string;
  /** 出现次数 */
  count: number;
  /** 最后出现时间 */
  lastOccurrence: string;
  /** 关联的提供商 */
  providers: Set<LLMProviderType>;
  /** 关联的模型 */
  models: Set<string>;
}

/**
 * 按模型分组的指标
 */
export interface ModelMetrics {
  /** 模型名称 */
  model: string;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 最小延迟（毫秒） */
  minLatency: number;
  /** 最大延迟（毫秒） */
  maxLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 平均每次请求成本 */
  averageCostPerRequest: number;
}

/**
 * 按提供商分组的指标
 */
export interface ProviderMetrics {
  /** 提供商类型 */
  provider: LLMProviderType;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 按模型分组的详细指标 */
  models: Map<string, ModelMetrics>;
}

/**
 * 完整统计报告
 */
export interface MetricsReport {
  /** 报告生成时间 */
  generatedAt: string;
  /** 统计时间范围 */
  timeRange: {
    start: string;
    end: string;
  };
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 成功率（百分比） */
  successRate: number;
  /** 平均延迟（毫秒） */
  averageLatency: number;
  /** 总输入 Token 数 */
  totalPromptTokens: number;
  /** 总输出 Token 数 */
  totalCompletionTokens: number;
  /** 总 Token 数 */
  totalTokens: number;
  /** 预估总成本（美元） */
  estimatedCost: number;
  /** 按提供商分组的指标 */
  providers: Map<LLMProviderType, ProviderMetrics>;
  /** 错误统计 */
  errors: ErrorMetric[];
}

/**
 * 指标收集器配置
 */
export interface MetricsCollectorConfig {
  /** 是否启用指标收集 */
  enabled?: boolean;
  /** 最大保存的请求数量 */
  maxRequests?: number;
  /** 是否记录详细日志 */
  verbose?: boolean;
}

/**
 * LLM 指标收集器
 * 负责收集、统计和分析 LLM 调用的各项指标
 */
export class MetricsCollector {
  /** 请求指标存储 */
  private requests: RequestMetric[] = [];

  /** 是否启用 */
  private enabled: boolean;

  /** 最大保存请求数 */
  private maxRequests: number;

  /** 是否记录详细日志 */
  private verbose: boolean;

  /** 当前活跃的请求（用于追踪未完成的请求） */
  private activeRequests: Map<string, RequestMetric> = new Map();

  constructor(config: MetricsCollectorConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.maxRequests = config.maxRequests ?? 10000;
    this.verbose = config.verbose ?? false;

    if (this.enabled) {
      logger.info('📊 MetricsCollector 已初始化');
    }
  }

  /**
   * 开始记录请求
   * @param provider 提供商类型
   * @param model 模型名称
   * @param metadata 额外元数据
   * @returns 请求 ID
   */
  startRequest(
    provider: LLMProviderType,
    model: string,
    metadata?: Record<string, unknown>
  ): string {
    if (!this.enabled) {
      return '';
    }

    const requestId = randomUUID();
    const metric: RequestMetric = {
      requestId,
      provider,
      model,
      startTime: new Date().toISOString(),
      success: false,
      metadata,
    };

    this.activeRequests.set(requestId, metric);

    if (this.verbose) {
      logger.debug(
        { requestId, provider, model },
        '📈 开始记录请求'
      );
    }

    return requestId;
  }

  /**
   * 记录成功请求
   * @param requestId 请求 ID
   * @param tokenUsage Token 使用情况
   * @param metadata 额外元数据
   */
  recordSuccess(
    requestId: string,
    tokenUsage?: TokenUsage,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.enabled || !requestId) {
      return;
    }

    const metric = this.activeRequests.get(requestId);
    if (!metric) {
      logger.warn({ requestId }, '未找到活跃请求');
      return;
    }

    const endTime = new Date();
    const startTime = new Date(metric.startTime);
    const latency = endTime.getTime() - startTime.getTime();

    metric.endTime = endTime.toISOString();
    metric.latency = latency;
    metric.tokenUsage = tokenUsage;
    metric.success = true;
    metric.estimatedCost = this.calculateCost(metric.model, tokenUsage);

    if (metadata) {
      metric.metadata = { ...metric.metadata, ...metadata };
    }

    this.addRequest(metric);
    this.activeRequests.delete(requestId);

    if (this.verbose) {
      logger.debug(
        {
          requestId,
          latency,
          tokenUsage,
          estimatedCost: metric.estimatedCost,
        },
        '✅ 记录成功请求'
      );
    }
  }

  /**
   * 记录失败请求
   * @param requestId 请求 ID
   * @param error 错误信息
   * @param errorType 错误类型
   * @param metadata 额外元数据
   */
  recordError(
    requestId: string,
    error: string,
    errorType?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.enabled || !requestId) {
      return;
    }

    const metric = this.activeRequests.get(requestId);
    if (!metric) {
      logger.warn({ requestId }, '未找到活跃请求');
      return;
    }

    const endTime = new Date();
    const startTime = new Date(metric.startTime);
    const latency = endTime.getTime() - startTime.getTime();

    metric.endTime = endTime.toISOString();
    metric.latency = latency;
    metric.success = false;
    metric.error = error;
    metric.errorType = errorType || 'UnknownError';

    if (metadata) {
      metric.metadata = { ...metric.metadata, ...metadata };
    }

    this.addRequest(metric);
    this.activeRequests.delete(requestId);

    if (this.verbose) {
      logger.debug(
        {
          requestId,
          latency,
          error,
          errorType: metric.errorType,
        },
        '❌ 记录失败请求'
      );
    }
  }

  /**
   * 直接记录完整的请求指标
   * @param metric 请求指标
   */
  recordRequest(metric: RequestMetric): void {
    if (!this.enabled) {
      return;
    }

    // 如果没有成本信息，自动计算
    if (!metric.estimatedCost && metric.tokenUsage) {
      metric.estimatedCost = this.calculateCost(metric.model, metric.tokenUsage);
    }

    this.addRequest(metric);

    if (this.verbose) {
      logger.debug(
        { requestId: metric.requestId, success: metric.success },
        '📝 记录请求指标'
      );
    }
  }

  /**
   * 添加请求到存储
   */
  private addRequest(metric: RequestMetric): void {
    this.requests.push(metric);

    // 如果超过最大数量，移除最旧的请求
    if (this.requests.length > this.maxRequests) {
      this.requests.shift();
    }
  }

  /**
   * 计算请求成本
   * @param model 模型名称
   * @param tokenUsage Token 使用情况
   * @returns 预估成本（美元）
   */
  calculateCost(model: string, tokenUsage?: TokenUsage): number {
    if (!tokenUsage) {
      return 0;
    }

    // 查找模型定价，支持模糊匹配
    let pricing = MODEL_PRICING[model];

    // 如果没有精确匹配，尝试模糊匹配
    if (!pricing) {
      const modelLower = model.toLowerCase();
      for (const [key, value] of Object.entries(MODEL_PRICING)) {
        if (modelLower.includes(key.toLowerCase()) || key.toLowerCase().includes(modelLower)) {
          pricing = value;
          break;
        }
      }
    }

    // 如果仍未找到，使用默认定价（GPT-3.5-turbo）
    if (!pricing) {
      pricing = MODEL_PRICING['gpt-3.5-turbo'];
      logger.warn(
        { model, defaultPricing: pricing },
        '未找到模型定价，使用默认定价'
      );
    }

    // 计算成本（价格单位是每 1K tokens）
    const promptCost = (tokenUsage.promptTokens / 1000) * pricing.prompt;
    const completionCost = (tokenUsage.completionTokens / 1000) * pricing.completion;

    return Number((promptCost + completionCost).toFixed(6));
  }

  /**
   * 获取所有请求指标
   */
  getRequests(): RequestMetric[] {
    return [...this.requests];
  }

  /**
   * 获取指定时间范围内的请求
   * @param startTime 开始时间
   * @param endTime 结束时间
   */
  getRequestsByTimeRange(startTime: Date, endTime: Date): RequestMetric[] {
    return this.requests.filter(req => {
      const reqTime = new Date(req.startTime);
      return reqTime >= startTime && reqTime <= endTime;
    });
  }

  /**
   * 获取指定提供商的请求
   * @param provider 提供商类型
   */
  getRequestsByProvider(provider: LLMProviderType): RequestMetric[] {
    return this.requests.filter(req => req.provider === provider);
  }

  /**
   * 获取指定模型的请求
   * @param model 模型名称
   */
  getRequestsByModel(model: string): RequestMetric[] {
    return this.requests.filter(req => req.model === model);
  }

  /**
   * 获取完整统计报告
   * @param startTime 开始时间（可选，默认为最早请求时间）
   * @param endTime 结束时间（可选，默认为当前时间）
   */
  getMetricsReport(startTime?: Date, endTime?: Date): MetricsReport {
    const filteredRequests = startTime || endTime
      ? this.getRequestsByTimeRange(
          startTime || new Date(0),
          endTime || new Date()
        )
      : this.requests;

    const generatedAt = new Date().toISOString();
    const timeRange = {
      start: filteredRequests.length > 0
        ? filteredRequests[0].startTime
        : generatedAt,
      end: filteredRequests.length > 0
        ? filteredRequests[filteredRequests.length - 1].startTime
        : generatedAt,
    };

    // 计算总体指标
    const totalRequests = filteredRequests.length;
    const successfulRequests = filteredRequests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

    const latencies = filteredRequests
      .filter(r => r.latency !== undefined)
      .map(r => r.latency!);
    const averageLatency = latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

    const totalPromptTokens = filteredRequests
      .filter(r => r.tokenUsage)
      .reduce((sum, r) => sum + r.tokenUsage!.promptTokens, 0);
    const totalCompletionTokens = filteredRequests
      .filter(r => r.tokenUsage)
      .reduce((sum, r) => sum + r.tokenUsage!.completionTokens, 0);
    const totalTokens = totalPromptTokens + totalCompletionTokens;

    const estimatedCost = filteredRequests
      .filter(r => r.estimatedCost !== undefined)
      .reduce((sum, r) => sum + r.estimatedCost!, 0);

    // 按提供商分组
    const providers = this.groupByProvider(filteredRequests);

    // 错误统计
    const errors = this.aggregateErrors(filteredRequests);

    return {
      generatedAt,
      timeRange,
      totalRequests,
      successfulRequests,
      failedRequests,
      successRate: Number(successRate.toFixed(2)),
      averageLatency: Number(averageLatency.toFixed(2)),
      totalPromptTokens,
      totalCompletionTokens,
      totalTokens,
      estimatedCost: Number(estimatedCost.toFixed(6)),
      providers,
      errors,
    };
  }

  /**
   * 按提供商分组统计
   */
  private groupByProvider(requests: RequestMetric[]): Map<LLMProviderType, ProviderMetrics> {
    const providerMap = new Map<LLMProviderType, ProviderMetrics>();

    // 按提供商分组
    const providerGroups = new Map<LLMProviderType, RequestMetric[]>();
    for (const req of requests) {
      const group = providerGroups.get(req.provider) || [];
      group.push(req);
      providerGroups.set(req.provider, group);
    }

    // 计算每个提供商的指标
    for (const [provider, reqs] of providerGroups) {
      const totalRequests = reqs.length;
      const successfulRequests = reqs.filter(r => r.success).length;
      const failedRequests = totalRequests - successfulRequests;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

      const latencies = reqs.filter(r => r.latency !== undefined).map(r => r.latency!);
      const averageLatency = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;

      const totalPromptTokens = reqs
        .filter(r => r.tokenUsage)
        .reduce((sum, r) => sum + r.tokenUsage!.promptTokens, 0);
      const totalCompletionTokens = reqs
        .filter(r => r.tokenUsage)
        .reduce((sum, r) => sum + r.tokenUsage!.completionTokens, 0);
      const totalTokens = totalPromptTokens + totalCompletionTokens;

      const estimatedCost = reqs
        .filter(r => r.estimatedCost !== undefined)
        .reduce((sum, r) => sum + r.estimatedCost!, 0);

      // 按模型分组
      const models = this.groupByModel(reqs);

      providerMap.set(provider, {
        provider,
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate: Number(successRate.toFixed(2)),
        averageLatency: Number(averageLatency.toFixed(2)),
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        estimatedCost: Number(estimatedCost.toFixed(6)),
        models,
      });
    }

    return providerMap;
  }

  /**
   * 按模型分组统计
   */
  private groupByModel(requests: RequestMetric[]): Map<string, ModelMetrics> {
    const modelMap = new Map<string, ModelMetrics>();

    // 按模型分组
    const modelGroups = new Map<string, RequestMetric[]>();
    for (const req of requests) {
      const group = modelGroups.get(req.model) || [];
      group.push(req);
      modelGroups.set(req.model, group);
    }

    // 计算每个模型的指标
    for (const [model, reqs] of modelGroups) {
      const totalRequests = reqs.length;
      const successfulRequests = reqs.filter(r => r.success).length;
      const failedRequests = totalRequests - successfulRequests;
      const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0;

      const latencies = reqs.filter(r => r.latency !== undefined).map(r => r.latency!);
      const averageLatency = latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0;
      const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
      const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;

      const totalPromptTokens = reqs
        .filter(r => r.tokenUsage)
        .reduce((sum, r) => sum + r.tokenUsage!.promptTokens, 0);
      const totalCompletionTokens = reqs
        .filter(r => r.tokenUsage)
        .reduce((sum, r) => sum + r.tokenUsage!.completionTokens, 0);
      const totalTokens = totalPromptTokens + totalCompletionTokens;

      const estimatedCost = reqs
        .filter(r => r.estimatedCost !== undefined)
        .reduce((sum, r) => sum + r.estimatedCost!, 0);
      const averageCostPerRequest = totalRequests > 0 ? estimatedCost / totalRequests : 0;

      modelMap.set(model, {
        model,
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate: Number(successRate.toFixed(2)),
        averageLatency: Number(averageLatency.toFixed(2)),
        minLatency: Number(minLatency.toFixed(2)),
        maxLatency: Number(maxLatency.toFixed(2)),
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        estimatedCost: Number(estimatedCost.toFixed(6)),
        averageCostPerRequest: Number(averageCostPerRequest.toFixed(6)),
      });
    }

    return modelMap;
  }

  /**
   * 聚合错误统计
   */
  private aggregateErrors(requests: RequestMetric[]): ErrorMetric[] {
    const errorMap = new Map<string, ErrorMetric>();

    for (const req of requests) {
      if (!req.success && req.error) {
        const errorKey = `${req.errorType || 'UnknownError'}:${req.error}`;

        if (errorMap.has(errorKey)) {
          const metric = errorMap.get(errorKey)!;
          metric.count++;
          metric.lastOccurrence = req.startTime;
          metric.providers.add(req.provider);
          metric.models.add(req.model);
        } else {
          errorMap.set(errorKey, {
            errorType: req.errorType || 'UnknownError',
            errorMessage: req.error,
            count: 1,
            lastOccurrence: req.startTime,
            providers: new Set([req.provider]),
            models: new Set([req.model]),
          });
        }
      }
    }

    // 按出现次数降序排序
    return Array.from(errorMap.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * 获取指定提供商的统计指标
   */
  getProviderMetrics(provider: LLMProviderType): ProviderMetrics | undefined {
    const requests = this.getRequestsByProvider(provider);
    if (requests.length === 0) {
      return undefined;
    }

    const providerMap = this.groupByProvider(requests);
    return providerMap.get(provider);
  }

  /**
   * 获取指定模型的统计指标
   */
  getModelMetrics(model: string): ModelMetrics | undefined {
    const requests = this.getRequestsByModel(model);
    if (requests.length === 0) {
      return undefined;
    }

    const modelMap = this.groupByModel(requests);
    return modelMap.get(model);
  }

  /**
   * 清除所有指标数据
   */
  clear(): void {
    this.requests = [];
    this.activeRequests.clear();
    logger.info('🗑️ 已清除所有指标数据');
  }

  /**
   * 清除指定时间范围之前的指标数据
   * @param before 截止时间
   */
  clearBefore(before: Date): void {
    const beforeTime = before.getTime();
    this.requests = this.requests.filter(
      req => new Date(req.startTime).getTime() >= beforeTime
    );
    logger.info({ before: before.toISOString() }, '🗑️ 已清除指定时间之前的指标数据');
  }

  /**
   * 获取当前活跃请求数量
   */
  getActiveRequestCount(): number {
    return this.activeRequests.size;
  }

  /**
   * 获取总请求数量
   */
  getTotalRequestCount(): number {
    return this.requests.length;
  }

  /**
   * 导出指标数据为 JSON
   */
  exportJSON(): string {
    const report = this.getMetricsReport();

    // 转换 Map 为数组以便 JSON 序列化
    const serializableReport = {
      generatedAt: report.generatedAt,
      timeRange: report.timeRange,
      totalRequests: report.totalRequests,
      successfulRequests: report.successfulRequests,
      failedRequests: report.failedRequests,
      successRate: report.successRate,
      averageLatency: report.averageLatency,
      totalPromptTokens: report.totalPromptTokens,
      totalCompletionTokens: report.totalCompletionTokens,
      totalTokens: report.totalTokens,
      estimatedCost: report.estimatedCost,
      providers: Array.from(report.providers.entries()).map(([key, value]) => ({
        provider: key,
        totalRequests: value.totalRequests,
        successfulRequests: value.successfulRequests,
        failedRequests: value.failedRequests,
        successRate: value.successRate,
        averageLatency: value.averageLatency,
        totalPromptTokens: value.totalPromptTokens,
        totalCompletionTokens: value.totalCompletionTokens,
        totalTokens: value.totalTokens,
        estimatedCost: value.estimatedCost,
        models: Array.from(value.models.entries()).map(([modelKey, modelValue]) => ({
          model: modelKey,
          totalRequests: modelValue.totalRequests,
          successfulRequests: modelValue.successfulRequests,
          failedRequests: modelValue.failedRequests,
          successRate: modelValue.successRate,
          averageLatency: modelValue.averageLatency,
          minLatency: modelValue.minLatency,
          maxLatency: modelValue.maxLatency,
          totalPromptTokens: modelValue.totalPromptTokens,
          totalCompletionTokens: modelValue.totalCompletionTokens,
          totalTokens: modelValue.totalTokens,
          estimatedCost: modelValue.estimatedCost,
          averageCostPerRequest: modelValue.averageCostPerRequest,
        })),
      })),
      errors: report.errors.map(err => ({
        errorType: err.errorType,
        errorMessage: err.errorMessage,
        count: err.count,
        lastOccurrence: err.lastOccurrence,
        providers: Array.from(err.providers),
        models: Array.from(err.models),
      })),
    };

    return JSON.stringify(serializableReport, null, 2);
  }

  /**
   * 打印摘要报告
   */
  printSummary(): void {
    const report = this.getMetricsReport();

    logger.info('📊 ========== LLM 指标统计报告 ==========');
    logger.info(`📅 时间范围: ${report.timeRange.start} ~ ${report.timeRange.end}`);
    logger.info(`📈 总请求数: ${report.totalRequests}`);
    logger.info(`✅ 成功请求: ${report.successfulRequests} (${report.successRate.toFixed(2)}%)`);
    logger.info(`❌ 失败请求: ${report.failedRequests}`);
    logger.info(`⏱️  平均延迟: ${report.averageLatency.toFixed(2)}ms`);
    logger.info(`🔤 总 Token: ${report.totalTokens} (输入: ${report.totalPromptTokens}, 输出: ${report.totalCompletionTokens})`);
    logger.info(`💰 预估成本: $${report.estimatedCost.toFixed(6)}`);

    logger.info('\n📊 按提供商统计:');
    for (const [provider, metrics] of report.providers) {
      logger.info(`  ${provider}:`);
      logger.info(`    请求数: ${metrics.totalRequests}, 成功率: ${metrics.successRate.toFixed(2)}%`);
      logger.info(`    Token: ${metrics.totalTokens}, 成本: $${metrics.estimatedCost.toFixed(6)}`);
    }

    if (report.errors.length > 0) {
      logger.info('\n❌ 错误统计:');
      for (const error of report.errors.slice(0, 5)) {
        logger.info(`  ${error.errorType}: ${error.count} 次`);
      }
    }

    logger.info('📊 ========================================');
  }
}
