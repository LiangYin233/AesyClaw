/**
 * 工具转换器模块
 * 用于统一处理不同 LLM 提供商的工具格式转换
 */

import type { ToolDefinition, ToolParameters } from '../../../platform/tools/types.js';

/**
 * OpenAI 工具定义格式
 * 符合 OpenAI function calling 规范
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
}

/**
 * Anthropic 工具定义格式
 * 符合 Anthropic tool use 规范
 */
export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: ToolParameters;
}

/**
 * 工具格式化器接口
 * 定义工具转换的通用接口
 */
export interface ToolFormatter<T> {
  /**
   * 将通用工具定义转换为特定提供商的格式
   * @param tool 通用工具定义
   * @returns 特定提供商的工具定义
   */
  format(tool: ToolDefinition): T;

  /**
   * 批量转换工具定义
   * @param tools 通用工具定义数组
   * @returns 特定提供商的工具定义数组
   */
  formatAll(tools: ToolDefinition[]): T[];
}

/**
 * OpenAI 工具格式化器
 * 生成符合 OpenAI function calling 规范的工具定义
 *
 * OpenAI 格式特点：
 * - 使用 `type: 'function'` 包装
 * - 参数放在 `function.parameters` 中
 */
export class OpenAIToolFormatter implements ToolFormatter<OpenAIToolDefinition> {
  /**
   * 将通用工具定义转换为 OpenAI 格式
   * @param tool 通用工具定义
   * @returns OpenAI 格式的工具定义
   */
  format(tool: ToolDefinition): OpenAIToolDefinition {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: this.transformParameters(tool.parameters),
      },
    };
  }

  /**
   * 批量转换工具定义为 OpenAI 格式
   * @param tools 通用工具定义数组
   * @returns OpenAI 格式的工具定义数组
   */
  formatAll(tools: ToolDefinition[]): OpenAIToolDefinition[] {
    return tools.map(tool => this.format(tool));
  }

  /**
   * 转换参数 schema
   * OpenAI 接受标准的 JSON Schema 格式，直接传递即可
   * @param parameters 工具参数定义
   * @returns 转换后的参数定义
   */
  private transformParameters(parameters: ToolParameters): ToolParameters {
    // OpenAI 接受标准 JSON Schema，直接返回
    // 但需要确保格式完整性
    return {
      type: parameters.type || 'object',
      properties: parameters.properties || {},
      required: parameters.required,
      additionalProperties: parameters.additionalProperties,
    };
  }
}

/**
 * Anthropic 工具格式化器
 * 生成符合 Anthropic tool use 规范的工具定义
 *
 * Anthropic 格式特点：
 * - 使用 `input_schema` 字段
 * - 参数直接放在 `input_schema` 中
 */
export class AnthropicToolFormatter implements ToolFormatter<AnthropicToolDefinition> {
  /**
   * 将通用工具定义转换为 Anthropic 格式
   * @param tool 通用工具定义
   * @returns Anthropic 格式的工具定义
   */
  format(tool: ToolDefinition): AnthropicToolDefinition {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: this.transformParameters(tool.parameters),
    };
  }

  /**
   * 批量转换工具定义为 Anthropic 格式
   * @param tools 通用工具定义数组
   * @returns Anthropic 格式的工具定义数组
   */
  formatAll(tools: ToolDefinition[]): AnthropicToolDefinition[] {
    return tools.map(tool => this.format(tool));
  }

  /**
   * 转换参数 schema
   * Anthropic 使用 input_schema 字段，格式与标准 JSON Schema 类似
   * @param parameters 工具参数定义
   * @returns 转换后的参数定义
   */
  private transformParameters(parameters: ToolParameters): ToolParameters {
    // Anthropic 接受标准 JSON Schema 格式
    // 确保必要的字段存在
    return {
      type: parameters.type || 'object',
      properties: parameters.properties || {},
      required: parameters.required,
      additionalProperties: parameters.additionalProperties,
    };
  }
}

/**
 * 工具转换器
 * 统一管理不同提供商的工具格式转换
 *
 * 使用示例：
 * ```typescript
 * const transformer = new ToolTransformer();
 * const openaiTools = transformer.toOpenAI(tools);
 * const anthropicTools = transformer.toAnthropic(tools);
 * ```
 */
export class ToolTransformer {
  private openaiFormatter: OpenAIToolFormatter;
  private anthropicFormatter: AnthropicToolFormatter;

  constructor() {
    this.openaiFormatter = new OpenAIToolFormatter();
    this.anthropicFormatter = new AnthropicToolFormatter();
  }

  /**
   * 将工具定义转换为 OpenAI 格式
   * @param tools 通用工具定义数组
   * @returns OpenAI 格式的工具定义数组
   */
  toOpenAI(tools: ToolDefinition[]): OpenAIToolDefinition[] {
    return this.openaiFormatter.formatAll(tools);
  }

  /**
   * 将工具定义转换为 Anthropic 格式
   * @param tools 通用工具定义数组
   * @returns Anthropic 格式的工具定义数组
   */
  toAnthropic(tools: ToolDefinition[]): AnthropicToolDefinition[] {
    return this.anthropicFormatter.formatAll(tools);
  }

  /**
   * 获取 OpenAI 格式化器实例
   * 用于需要自定义格式化的场景
   * @returns OpenAI 工具格式化器
   */
  getOpenAIFormatter(): OpenAIToolFormatter {
    return this.openaiFormatter;
  }

  /**
   * 获取 Anthropic 格式化器实例
   * 用于需要自定义格式化的场景
   * @returns Anthropic 工具格式化器
   */
  getAnthropicFormatter(): AnthropicToolFormatter {
    return this.anthropicFormatter;
  }
}

/**
 * 创建全局工具转换器实例
 * 提供单例模式访问
 */
let globalTransformer: ToolTransformer | null = null;

/**
 * 获取全局工具转换器实例
 * @returns 工具转换器实例
 */
export function getToolTransformer(): ToolTransformer {
  if (!globalTransformer) {
    globalTransformer = new ToolTransformer();
  }
  return globalTransformer;
}
