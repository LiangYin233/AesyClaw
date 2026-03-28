import type { LLMMessage } from '../../../types.js';
import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { ExecutionStrategy, ExecutionResult, ExecutionOptions } from './ExecutionTypes.js';
import type { ToolLoopRunner } from './ToolLoopRunner.js';

/**
 * 同步执行策略。
 * 直接复用 ToolLoopRunner 完成当前轮次执行。
 */
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
