import type { LLMMessage, ToolCall } from '../../../types.js';
import type { ToolContext } from '../../../tools/ToolRegistry.js';
import type { ExecutionScope } from '../contracts.js';

export interface VisionSettings {
  enabled?: boolean;
  visionProviderName?: string;
  visionModelName?: string;
  reasoning?: boolean;
}

export interface ExecutionResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
}

export interface ExecutionOptions {
  allowTools?: boolean;
  maxIterations?: number;
  sessionKey?: string;
  source?: 'user' | 'cron';
  initialToolCalls?: ToolCall[];
  signal?: AbortSignal;
  executionMetadata?: {
    scope?: ExecutionScope;
    channel?: string;
    chatId?: string;
    startedAt?: Date;
  };
}

export interface BackgroundExecutionResult extends ExecutionResult {
  needsBackground: boolean;
  backgroundState?: {
    messages: LLMMessage[];
    toolContext: ToolContext;
    startIndex: number;
  };
}

export interface LLMCallOptions {
  allowTools?: boolean;
  maxIterations?: number;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface ExecutionStrategy {
  readonly name: 'sync' | 'background' | 'vision';

  execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult>;
}
