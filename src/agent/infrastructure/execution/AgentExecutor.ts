import type { LLMMessage, InboundFile } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { ToolRegistry, ToolContext } from '../../../platform/tools/ToolRegistry.js';
import { ContextBuilder } from './ContextBuilder.js';
import { ToolLoopRunner } from './ToolLoopRunner.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import type { ExecutionOptions } from './ExecutionTypes.js';
import type { PluginManager } from '../../../platform/context/PluginContext.js';

export class AgentExecutor {
  private contextBuilder: ContextBuilder;
  private toolLoopRunner: ToolLoopRunner;
  private executionRegistry: ExecutionRegistry;
  private model: string;
  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    workspace: string,
    systemPrompt?: string,
    skillsPrompt?: string,
    model?: string,
    maxContextTokens?: number,
    private maxIterations: number = 40,
    pluginManager?: PluginManager,
    executionRegistry?: ExecutionRegistry,
    includeRuntimeContext: boolean = true
  ) {
    if (!model?.trim()) {
      throw new Error('AgentExecutor requires an explicit model');
    }

    this.model = model;
    this.executionRegistry = executionRegistry ?? new ExecutionRegistry();
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt, includeRuntimeContext);
    this.toolLoopRunner = new ToolLoopRunner(provider, toolRegistry, pluginManager, maxContextTokens);
  }

  buildMessages(history: any[], currentMessage: string, media?: string[], files?: InboundFile[]): LLMMessage[] {
    return this.contextBuilder.build(history, currentMessage, media, files);
  }

  setCurrentContext(channel?: string, chatId?: string, messageType?: 'private' | 'group'): void {
    this.contextBuilder.setCurrentContext(channel, chatId, messageType);
  }

  setSkillsPrompt(prompt: string): void {
    this.contextBuilder.setSkillsPrompt(prompt);
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.toolLoopRunner.setProvider(provider);
    if (model) this.model = model;
  }

  /**
   * 中止指定 session 的执行。
   */
  abort(sessionKey: string): void {
    this.executionRegistry.abort(sessionKey);
  }

  /**
   * 直接运行工具循环，并复用当前执行控制逻辑。
   */
  async executeToolLoop(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecutionOptions
  ): Promise<{
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
  }> {
    return this.runWithExecutionControl(options, (executionOptions) =>
      this.toolLoopRunner.run(messages, toolContext, {
        ...executionOptions,
        model: this.model,
        allowTools: executionOptions.allowTools ?? true,
        maxIterations: executionOptions.maxIterations ?? this.maxIterations
      })
    );
  }

  /**
   * 为同一 session 复用中止控制，避免并发执行彼此失联。
   */
  private async runWithExecutionControl<T>(
    options: ExecutionOptions | undefined,
    execute: (executionOptions: ExecutionOptions) => Promise<T>
  ): Promise<T> {
    if (!options?.sessionKey) {
      return execute({ ...(options || {}) });
    }

    const controller = options.signal
      ? undefined
      : this.executionRegistry.begin(options.sessionKey, undefined, options.executionMetadata);
    const signal = options.signal ?? controller?.signal;

    try {
      return await execute({ ...(options || {}), signal });
    } finally {
      if (controller) {
        this.executionRegistry.end(options.sessionKey, controller);
      }
    }
  }
}
