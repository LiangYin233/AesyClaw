import type { LLMMessage, InboundFile } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { ToolRegistry, ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import { ContextBuilder } from './ContextBuilder.js';
import { ToolLoopRunner } from './ToolLoopRunner.js';
import { SyncStrategy } from './ExecutionStrategies.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import type { ExecutionResult, ExecutionOptions } from './ExecutionTypes.js';

export class AgentExecutor {
  private contextBuilder: ContextBuilder;
  private toolLoopRunner: ToolLoopRunner;
  private syncStrategy: SyncStrategy;
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

    this.syncStrategy = new SyncStrategy(this.toolLoopRunner, model);
  }

  /**
   * 同步执行
   */
  async execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    return this.runWithExecutionControl(options, (executionOptions) =>
      this.syncStrategy.execute(messages, toolContext, {
        allowTools: true,
        maxIterations: this.maxIterations,
        ...executionOptions
      })
    );
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

  // === BackgroundTaskExecutor 接口方法 ===

  abort(sessionKey: string): void {
    this.executionRegistry.abort(sessionKey);
  }

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
