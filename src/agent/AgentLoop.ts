import type { LLMMessage, InboundMessage, OutboundMessage, VisionSettings } from '../types.js';
import type { EventBus } from '../bus/EventBus.js';
import type { LLMProvider } from '../providers/base.js';
import type { ToolRegistry, ToolContext } from '../tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { PluginManager } from '../plugins/index.js';
import { SkillManager } from '../skills/index.js';
import { CommandRegistry } from './commands/index.js';
import { AgentExecutor } from './executor/AgentExecutor.js';
import { BackgroundTaskManager } from './BackgroundTaskManager.js';
import { SessionRoutingService } from './SessionRoutingService.js';
import { ExecutionRegistry } from './ExecutionRegistry.js';
import { ExecutionCompletionService } from './ExecutionCompletionService.js';
import { ExecutionControlService, type ExecutionStatus } from './ExecutionControlService.js';
import { ExecutionCoordinator } from './ExecutionCoordinator.js';
import { MessageApplicationService } from './MessageApplicationService.js';
import { MessagePreprocessingService } from './MessagePreprocessingService.js';
import { logger } from '../logger/index.js';
import { metrics } from '../logger/Metrics.js';
import { CONFIG_DEFAULTS } from '../constants/index.js';

export type ContextMode = 'session' | 'channel' | 'global';

export class AgentLoop {
  private eventBus: EventBus;
  private sessionManager: SessionManager;
  private executor: AgentExecutor;
  private backgroundTasks: BackgroundTaskManager;
  private sessionRouting: SessionRoutingService;
  private executionRegistry: ExecutionRegistry;
  private completionService: ExecutionCompletionService;
  private executionControl: ExecutionControlService;
  private executionCoordinator: ExecutionCoordinator;
  private messageApplication: MessageApplicationService;
  private preprocessingService: MessagePreprocessingService;
  private running = false;
  private toolContext: ToolContext;
  private contextMode: ContextMode;
  private memoryWindow: number;
  private currentSessionKey?: string;
  private pluginManager?: PluginManager;
  private commandRegistry?: CommandRegistry;
  private visionSettings?: VisionSettings;
  private visionProvider?: LLMProvider;
  private log = logger.child({ prefix: 'Agent' });

  constructor(
    eventBus: EventBus,
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    sessionManager: SessionManager,
    workspace: string,
    systemPrompt?: string,
    maxIterations: number = CONFIG_DEFAULTS.DEFAULT_MAX_ITERATIONS,
    model: string = 'gpt-4o',
    contextMode: ContextMode = 'channel',
    memoryWindow: number = CONFIG_DEFAULTS.DEFAULT_MEMORY_WINDOW,
    skillManager?: SkillManager,
    visionSettings?: VisionSettings,
    visionProvider?: LLMProvider,
    sessionRouting?: SessionRoutingService
  ) {
    this.eventBus = eventBus;
    this.sessionManager = sessionManager;
    this.contextMode = contextMode;
    this.memoryWindow = memoryWindow;
    this.executionRegistry = new ExecutionRegistry();
    this.sessionRouting = sessionRouting ?? new SessionRoutingService(sessionManager, contextMode);
    this.completionService = new ExecutionCompletionService(sessionManager);
    this.toolContext = { workspace, eventBus };
    this.visionSettings = visionSettings;
    this.visionProvider = visionProvider;

    const skillsPrompt = skillManager?.buildSkillsPrompt() || '';
    this.executor = new AgentExecutor(
      provider, toolRegistry, workspace,
      systemPrompt, skillsPrompt, model, maxIterations,
      undefined, visionSettings, visionProvider, this.executionRegistry
    );

    // 初始化后台任务管理器
    this.backgroundTasks = new BackgroundTaskManager(eventBus);
    this.executionControl = new ExecutionControlService(
      this.sessionRouting,
      this.executionRegistry,
      this.backgroundTasks
    );
    this.executionCoordinator = new ExecutionCoordinator(
      this.executor,
      this.backgroundTasks,
      this.completionService
    );
    this.messageApplication = new MessageApplicationService(
      this.executor,
      this.executionCoordinator
    );
    this.preprocessingService = new MessagePreprocessingService();

    this.log.info(`Initialized with model: ${model}, contextMode: ${contextMode}, vision: ${visionSettings?.enabled || false}`);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
    this.executor.setPluginManager(pm);
    this.completionService = new ExecutionCompletionService(this.sessionManager, pm);
    this.executionCoordinator = new ExecutionCoordinator(
      this.executor,
      this.backgroundTasks,
      this.completionService
    );
    this.messageApplication = new MessageApplicationService(
      this.executor,
      this.executionCoordinator,
      pm
    );
    this.preprocessingService = new MessagePreprocessingService(
      this.commandRegistry,
      pm
    );
    this.log.info('PluginManager attached');
  }

  setSkillManager(sm: SkillManager): void {
    this.executor.setSkillsPrompt(sm.buildSkillsPrompt());
    this.log.info('SkillManager attached');
  }

  async callLLM(
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    const result = await this.executor.callLLM(messages, options);
    return result;
  }

  async run(): Promise<void> {
    this.running = true;
    this.log.info('Loop started, waiting for messages...');

    while (this.running) {
      try {
        const msg = await this.eventBus.consumeInbound();
        this.log.debug(`Received message from ${msg.channel}:${msg.chatId}, content: ${msg.content.slice(0, 50)}...`);
        await this.processMessage(msg);
      } catch (error) {
        if (this.running) {
          this.log.error('Error:', error);
        }
      }
    }
  }

  private async processMessage(msg: InboundMessage, suppressOutbound = false): Promise<string | undefined> {
    const endTimer = metrics.timer('agent.process_message', {
      channel: msg.channel,
      sessionKey: msg.sessionKey || 'unknown'
    });

    try {
      this.log.debug(`processMessage: content="${msg.content}", media=${JSON.stringify(msg.media)}`);

      this.toolContext = {
        ...this.toolContext,
        channel: msg.channel,
        chatId: msg.chatId,
        messageType: msg.messageType
      };

      const { sessionKey: initialSessionKey } = this.sessionRouting.resolve(msg);
      msg.sessionKey = initialSessionKey;

      const preprocessResult = await this.preprocessingService.process(msg, {
        suppressOutbound,
        sendOutbound: (outbound) => this.sendOutbound(outbound)
      });

      if (preprocessResult.type === 'handled') {
        return undefined;
      }

      if (preprocessResult.type === 'reply') {
        return preprocessResult.content;
      }

      msg = preprocessResult.message;

      // sessionKey 已在预处理阶段计算，直接使用
      // 如果插件处理后丢失，从 channelSessions 恢复
      let sessionKey = msg.sessionKey;
      if (!sessionKey && this.contextMode === 'channel') {
        sessionKey = this.sessionRouting.getActiveSession(msg.channel, msg.chatId);
      }
      if (!sessionKey) {
        sessionKey = this.sessionRouting.createNewSession(msg.channel, msg.chatId);
      }

      this.currentSessionKey = sessionKey;
      this.log.debug(`Processing message for session: ${sessionKey} (mode: ${this.contextMode})`);
      const session = await this.sessionManager.getOrCreate(sessionKey);
      this.log.debug(`Session messages count: ${session.messages.length}`);

      const executionResult = await this.messageApplication.execute({
        sessionKey,
        request: msg,
        history: session.messages.slice(-this.memoryWindow),
        toolContext: this.toolContext,
        suppressOutbound,
        sendOutbound: (outbound) => this.sendOutbound(outbound)
      });

      if (executionResult.needsBackground) {
        this.log.info(`Session ${sessionKey} delegated to background, returning immediately`);
        metrics.record('agent.message_count', 1, 'count', { status: 'background' });
        return executionResult.content;
      }

      metrics.record('agent.message_count', 1, 'count', { status: 'success' });
      return executionResult.content;
    } catch (error) {
      this.log.error(`Failed to process message from ${msg.channel}:${msg.chatId}:`, error);
      metrics.record('agent.message_count', 1, 'count', { status: 'error' });
      throw error;
    } finally {
      this.currentSessionKey = undefined;
      endTimer();
    }
  }

  /**
   * 中止指定会话的执行
   */
  abortExecution(sessionKey: string): void {
    const aborted = this.executionControl.abortExecution(sessionKey);
    this.log.info(aborted
      ? `Aborted execution for session: ${sessionKey}`
      : `Abort requested for inactive session: ${sessionKey}`);
  }

  async processInbound(msg: InboundMessage): Promise<string | undefined> {
    return this.processMessage(msg, true);
  }

  async processDirect(
    content: string,
    sessionKey: string,
    contextOverride?: Partial<ToolContext>
  ): Promise<string> {
    const response = await this.processInbound({
      channel: contextOverride?.channel || 'api',
      senderId: contextOverride?.chatId || 'api',
      chatId: contextOverride?.chatId || 'api',
      content,
      timestamp: new Date(),
      sessionKey,
      messageType: contextOverride?.messageType,
      metadata: {
        suppressOutbound: true,
        directResponse: true
      }
    });

    return response || '';
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.executor.updateProvider(provider, model);
    this.log.info(model ? `Provider and model updated: ${model}` : 'Provider updated');
  }

  private async sendOutbound(msg: OutboundMessage): Promise<void> {
    let processedMsg = msg;
    if (this.pluginManager) {
      processedMsg = await this.pluginManager.applyOnResponse(msg) || msg;
    }
    await this.eventBus.publishOutbound(processedMsg);
  }

  setCommandRegistry(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.preprocessingService = new MessagePreprocessingService(
      registry,
      this.pluginManager
    );
    this.log.info('CommandRegistry attached');
  }

  /**
   * 获取当前正在执行的会话 key
   */
  getCurrentSessionKey(): string | undefined {
    return this.currentSessionKey;
  }

  /**
   * 根据 channel:chatId 获取当前会话 key
   */
  getSessionKey(channel: string, chatId: string): string | undefined {
    return this.sessionRouting.resolveByChannel(channel, chatId);
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus {
    return this.executionControl.getExecutionStatus(sessionKey);
  }

  /**
   * 直接中止指定会话的执行（供 channel 直接调用）
   */
  abortSession(channel: string, chatId: string): boolean {
    const aborted = this.executionControl.abortSession(channel, chatId);
    if (aborted) {
      const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
      this.log.info(`Aborted session: ${sessionKey} (channel: ${channel}, chatId: ${chatId})`);
    }
    return aborted;
  }

  /**
   * 中止指定 channel:chatId 的后台任务
   */
  abortBackgroundSession(channel: string, chatId: string): boolean {
    const aborted = this.executionControl.abortBackgroundSession(channel, chatId);
    if (aborted) {
      const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
      this.log.info(`Aborted background tasks for session: ${sessionKey} (channel: ${channel}, chatId: ${chatId})`);
    }
    return aborted;
  }
}
