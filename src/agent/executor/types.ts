import type { LLMMessage, ToolCall } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';

// 视觉设置
export interface VisionSettings {
  enabled?: boolean;
  visionProviderName?: string;
  visionModelName?: string;
  reasoning?: boolean;
}

// 执行结果
export interface ExecutionResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
}

// 执行选项
export interface ExecutionOptions {
  allowTools?: boolean;
  maxIterations?: number;
  sessionKey?: string;
  source?: 'user' | 'cron';
  initialToolCalls?: ToolCall[];
  signal?: AbortSignal;
}

// 后台执行结果
export interface BackgroundExecutionResult extends ExecutionResult {
  needsBackground: boolean;
  backgroundState?: {
    messages: LLMMessage[];
    toolContext: ToolContext;
    startIndex: number;
  };
}

// LLM 调用选项
export interface LLMCallOptions {
  allowTools?: boolean;
  maxIterations?: number;
  reasoning?: boolean;
  signal?: AbortSignal;
}

// 策略接口
export interface ExecutionStrategy {
  readonly name: 'sync' | 'background' | 'vision';

  execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult>;
}
