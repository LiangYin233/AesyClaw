import type { LLMMessage, InboundFile } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { PluginManager } from '../../plugins/index.js';
import { ContextBuilder } from '../ContextBuilder.js';
import { logger } from '../../logger/index.js';
import { ToolLoopRunner } from './ToolLoopRunner.js';
import { SyncStrategy, BackgroundStrategy, VisionStrategy } from './strategies.js';
import type { ExecutionResult, BackgroundExecutionResult, ExecutionOptions, LLMCallOptions, VisionSettings } from './types.js';

export class AgentExecutor {
  private contextBuilder: ContextBuilder;
  private toolLoopRunner: ToolLoopRunner;
  private syncStrategy: SyncStrategy;
  private backgroundStrategy: BackgroundStrategy;
  private visionStrategy?: VisionStrategy;
  private log = logger.child({ prefix: 'AgentExecutor' });

  constructor(
    private provider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private workspace: string,
    systemPrompt?: string,
    skillsPrompt?: string,
    private model: string = 'gpt-4o',
    private maxIterations: number = 40,
    private pluginManager?: PluginManager,
    visionSettings?: VisionSettings,
    visionProvider?: LLMProvider
  ) {
    this.contextBuilder = new ContextBuilder(workspace, systemPrompt, skillsPrompt);
    this.toolLoopRunner = new ToolLoopRunner(provider, toolRegistry, pluginManager, visionSettings);

    this.syncStrategy = new SyncStrategy(this.toolLoopRunner, model);
    this.backgroundStrategy = new BackgroundStrategy(
      this.toolLoopRunner,
      model,
      undefined // onNeedsBackground 由外部设置
    );

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
    return this.syncStrategy.execute(messages, toolContext, {
      allowTools: true,
      maxIterations: this.maxIterations,
      ...options
    });
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
    return strategy.execute(messages, toolContext, {
      allowTools: true,
      maxIterations: this.maxIterations,
      ...options
    });
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
    return this.visionStrategy.execute(messages, toolContext, {
      allowTools: true,
      maxIterations: this.maxIterations,
      ...options
    });
  }

  /**
   * 直接 LLM 调用
   */
  async callLLM(
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<{ content: string; reasoning_content?: string }> {
    const result = await this.toolLoopRunner.callLLM(
      messages,
      this.model,
      { allowTools: options?.allowTools }
    );

    return { content: result.content || '', reasoning_content: result.reasoning_content };
  }

  private hasVisionContent(messages: LLMMessage[]): boolean {
    return messages.some(msg =>
      Array.isArray(msg.content) && msg.content.some((c: any) => c.type === 'image_url')
    );
  }

  // === 兼容原有接口 ===

  buildContext(history: any[], currentMessage: string, media?: string[], files?: InboundFile[]): LLMMessage[] {
    return this.contextBuilder.build(history, currentMessage, media);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
  }

  setSkillsPrompt(prompt: string): void {
    this.contextBuilder.setSkillsPrompt(prompt);
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.provider = provider;
    if (model) this.model = model;
  }

  getContextBuilder(): ContextBuilder {
    return this.contextBuilder;
  }

  needsVisionProvider(media?: string[], files?: InboundFile[]): boolean {
    if (!this.visionStrategy) return false;
    const hasMedia = media && media.length > 0;
    const hasVisionableFiles = files?.some(f =>
      f.type === 'image' || this.isVisionableFile(f)
    ) ?? false;
    return hasMedia || hasVisionableFiles;
  }

  private isVisionableFile(file: InboundFile): boolean {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    return imageExtensions.some(ext => file.name?.toLowerCase().endsWith(ext));
  }

  // === BackgroundTaskExecutor 接口方法 ===

  abort(sessionKey: string): void {
    // TODO: 实现中止功能
    this.log.info(`Abort requested for session: ${sessionKey}`);
  }

  async executeToolLoop(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options?: {
      sessionKey?: string;
      allowTools?: boolean;
      source?: 'user' | 'cron';
      initialToolCalls?: any[];
    }
  ): Promise<{
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
  }> {
    return this.toolLoopRunner.run(messages, toolContext, {
      ...options,
      model: this.model,
      allowTools: options?.allowTools ?? true,
      maxIterations: this.maxIterations
    });
  }
}

// 向后兼容的类型别名
export type ExecuteOptions = ExecutionOptions;
export type AgentResult = ExecutionResult;
