import type { LLMMessage } from '../../types.js';
import type { ToolContext } from '../../tools/ToolRegistry.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ExecutionStrategy, ExecutionResult, ExecutionOptions, BackgroundExecutionResult } from './ExecutionTypes.js';
import type { ToolLoopRunner } from './ToolLoopRunner.js';
import { logger } from '../../observability/index.js';

// SyncStrategy
export class SyncStrategy implements ExecutionStrategy {
  readonly name = 'sync' as const;

  constructor(private runner: ToolLoopRunner, private model: string) {}

  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    return this.runner.run(messages, toolContext, {
      ...options,
      model: this.model,
      allowTools: options.allowTools ?? true
    });
  }
}

// BackgroundStrategy
export class BackgroundStrategy implements ExecutionStrategy {
  readonly name = 'background' as const;
  private log = logger.child('BackgroundStrategy');

  constructor(
    private runner: ToolLoopRunner,
    private model: string,
    private onNeedsBackground?: (
      response: { content: string; reasoning_content?: string; toolCalls: any[] },
      messages: LLMMessage[],
      toolContext: ToolContext
    ) => Promise<void>
  ) {}

  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<BackgroundExecutionResult> {
    const llmResult = await this.runner.callLLM(
      messages,
      this.model,
      {
        allowTools: options.allowTools !== false,
        signal: options.signal
      }
    );

    if (llmResult.toolCalls.length === 0) {
      messages.push({ role: 'assistant', content: llmResult.content || '' });
      return {
        content: llmResult.content || '',
        reasoning_content: llmResult.reasoning_content,
        toolsUsed: [],
        agentMode: false,
        needsBackground: false,
        backgroundState: undefined
      };
    }

    messages.push({
      role: 'assistant',
      content: llmResult.content || '',
      toolCalls: llmResult.toolCalls
    });

    if (this.onNeedsBackground) {
      await this.onNeedsBackground(llmResult, messages, toolContext);
    }

    return {
      content: llmResult.content || '',
      reasoning_content: llmResult.reasoning_content,
      toolsUsed: [],
      agentMode: true,
      needsBackground: true,
      backgroundState: {
        messages,
        toolContext,
        startIndex: messages.length - llmResult.toolCalls.length
      }
    };
  }
}

// VisionStrategy
export class VisionStrategy implements ExecutionStrategy {
  readonly name = 'vision' as const;
  private log = logger.child('VisionStrategy');

  constructor(
    private runner: ToolLoopRunner,
    private visionProvider: LLMProvider,
    private visionModel: string,
    private visionSettings?: { reasoning?: boolean }
  ) {}

  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    this.log.info(`正在使用视觉模型: ${this.visionModel}`);

    const visionMessages = this.buildVisionMessages(messages);

    return this.runner.run(visionMessages, toolContext, {
      ...options,
      model: this.visionModel,
      allowTools: options.allowTools ?? true,
      providerOverride: this.visionProvider,
      reasoningOverride: this.visionSettings?.reasoning
    });
  }

  private buildVisionMessages(messages: LLMMessage[]): LLMMessage[] {
    const result = [...messages];
    const lastIdx = result.length - 1;
    if (lastIdx < 0) return result;

    const lastMsg = result[lastIdx];
    if (!Array.isArray(lastMsg.content)) return result;

    const hasImage = lastMsg.content.some((c: any) => c.type === 'image_url');
    if (hasImage) return result;

    return result;
  }
}
