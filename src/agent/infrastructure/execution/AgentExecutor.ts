import type { LLMMessage, InboundFile } from '../../../types.js';
import type { LLMProvider } from '../../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../../tools/ToolRegistry.js';
import type { PluginManager } from '../../../plugins/index.js';
import { ContextBuilder } from './ContextBuilder.js';
import { logger } from '../../../observability/index.js';
import { ToolLoopRunner } from './ToolLoopRunner.js';
import { SyncStrategy, BackgroundStrategy, VisionStrategy } from './ExecutionStrategies.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import { isVisionableFile } from './ExecutionTypes.js';
import type { ExecutionResult, BackgroundExecutionResult, ExecutionOptions, LLMCallOptions, VisionSettings } from './ExecutionTypes.js';

export class AgentExecutor {
  private contextBuilder: ContextBuilder;
  private toolLoopRunner: ToolLoopRunner;
  private syncStrategy: SyncStrategy;
  private visionStrategy?: VisionStrategy;
  private visionProvider?: LLMProvider;
  private visionModel?: string;
  private executionRegistry: ExecutionRegistry;
  private model: string;
  private log = logger.child('AgentExecutor');

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
    visionSettings?: VisionSettings,
    visionProvider?: LLMProvider,
    executionRegistry?: ExecutionRegistry,
    includeRuntimeContext: boolean = true
  ) {
    if (!model?.trim()) {
      throw new Error('AgentExecutor requires an explicit model');
    }

    this.model = model;
    this.executionRegistry = executionRegistry ?? new ExecutionRegistry();
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt, includeRuntimeContext);
    this.toolLoopRunner = new ToolLoopRunner(provider, toolRegistry, pluginManager, visionSettings, maxContextTokens);
    this.visionProvider = visionProvider;
    this.visionModel = visionSettings?.visionModelName;

    this.syncStrategy = new SyncStrategy(this.toolLoopRunner, model);
    if (visionProvider && visionSettings?.visionModelName) {
      this.visionStrategy = new VisionStrategy(
        this.toolLoopRunner,
        visionProvider,
        visionSettings.visionModelName,
        visionSettings
      );
    }
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

  /**
   * 后台执行
   */
  async executeWithBackground(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecutionOptions & {
      onNeedsBackground?: (
        response: { content: string; reasoning_content?: string; toolCalls: any[] },
        messages: LLMMessage[],
        toolContext: ToolContext
      ) => Promise<void>;
    }
  ): Promise<BackgroundExecutionResult> {
    const strategy = new BackgroundStrategy(
      this.toolLoopRunner,
      this.model,
      options?.onNeedsBackground
    );

    return this.runWithExecutionControl(options, (executionOptions) =>
      strategy.execute(messages, toolContext, {
        allowTools: true,
        maxIterations: this.maxIterations,
        ...executionOptions
      })
    );
  }

  /**
   * 视觉模型执行
   */
  async executeWithVision(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    if (!this.visionStrategy) {
      throw new Error('Vision provider not configured');
    }
    return this.runWithExecutionControl(options, (executionOptions) =>
      this.visionStrategy!.execute(messages, toolContext, {
        allowTools: true,
        maxIterations: this.maxIterations,
        ...executionOptions
      })
    );
  }

  /**
   * 直接 LLM 调用
   */
  async callLLM(
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<{ content: string; reasoning_content?: string; toolCalls: any[] }> {
    const result = await this.toolLoopRunner.callLLM(
      messages,
      this.model,
      { allowTools: options?.allowTools, reasoning: options?.reasoning, signal: options?.signal }
    );

    return {
      content: result.content || '',
      reasoning_content: result.reasoning_content,
      toolCalls: result.toolCalls
    };
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

  needsVisionProvider(media?: string[], files?: InboundFile[]): boolean {
    if (!this.visionStrategy) return false;
    const hasMedia = media && media.length > 0;
    const hasVisionableFiles = files?.some(isVisionableFile) ?? false;
    return hasMedia || hasVisionableFiles;
  }

  async summarizeVisionInput(messages: LLMMessage[], signal?: AbortSignal): Promise<string | undefined> {
    if (!this.visionProvider || !this.visionModel) {
      return undefined;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || !Array.isArray(lastMessage.content)) {
      return undefined;
    }

    const hasImage = lastMessage.content.some((item: any) => item.type === 'image_url');
    if (!hasImage) {
      return undefined;
    }

    try {
      const response = await this.visionProvider.chat([
        {
          role: 'system',
          content: '请用中文简洁概括用户提供的图片内容，提取主体、场景、可见文字、关键细节和后续对话有用的信息。若有多张图，请按序号分点描述。只输出摘要内容，不要寒暄。'
        },
        {
          role: 'user',
          content: lastMessage.content
        }
      ], undefined, this.visionModel, {
        reasoning: false,
        signal
      });

      return response.content?.trim() || undefined;
    } catch (error) {
      this.log.warn('图片内容摘要生成失败', {
        model: this.visionModel,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  // === BackgroundTaskExecutor 接口方法 ===

  abort(sessionKey: string): void {
    const aborted = this.executionRegistry.abort(sessionKey);
    this.log.info(aborted
      ? `已请求中止会话: ${sessionKey}`
      : `会话当前没有运行中的任务: ${sessionKey}`);
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
