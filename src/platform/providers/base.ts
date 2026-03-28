import type { LLMMessage, LLMResponse, ToolDefinition } from '../../types.js';

/**
 * LLM 接入层抽象基类。
 * 各模型适配器统一实现该接口。
 */
export abstract class LLMProvider {
  /**
   * 初始化接入层基础配置。
   */
  constructor(
    _apiKey?: string,
    _apiBase?: string,
    _headers?: Record<string, string>,
    _extraBody?: Record<string, any>
  ) {}

  /**
   * 发送一次 LLM 对话请求。
   */
  abstract chat(
    messages: LLMMessage[],
    tools?: ToolDefinition[],
    model?: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      reasoning?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<LLMResponse>;
}
