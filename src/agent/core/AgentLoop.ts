import type { LLMMessage, InboundMessage, OutboundMessage, VisionSettings } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { PluginManager } from '../../plugins/index.js';
import { SkillManager } from '../../skills/index.js';
import { CommandRegistry } from '../commands/index.js';
import { AgentExecutor } from '../executor/AgentExecutor.js';
import { BackgroundTaskManager, type BackgroundTaskHandle } from '../state/BackgroundTaskManager.js';
import { SessionRoutingService } from '../routing/SessionRoutingService.js';
import { ExecutionRegistry, type ForegroundExecutionHandle } from '../execution/registry/ExecutionRegistry.js';
import { ExecutionCompletionService } from '../execution/registry/ExecutionCompletionService.js';
import { ExecutionCoordinator } from '../routing/ExecutionCoordinator.js';
import { MessagePreprocessingService } from '../messaging/MessagePreprocessingService.js';
import { SessionMemoryService } from '../memory/SessionMemoryService.js';
import { logger } from '../../logger/index.js';
import { metrics } from '../../logger/Metrics.js';
import { CONFIG_DEFAULTS } from '../../constants/index.js';

export type ContextMode = 'session' | 'channel' | 'global';

export interface ExecutionStatus {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export class AgentLoop {
  private eventBus: EventBus;
  private sessionManager: SessionManager;
  private executor: AgentExecutor;
  private backgroundTasks: BackgroundTaskManager;
  private sessionRouting: SessionRoutingService;
  private executionRegistry: ExecutionRegistry;
  private completionService!: ExecutionCompletionService;
  private executionCoordinator!: ExecutionCoordinator;
  private preprocessingService: MessagePreprocessingService;
  private running = false;
  private toolContext: ToolContext;
  private contextMode: ContextMode;
  private memoryWindow: number;
  private currentSessionKey?: string;
  private pluginManager?: PluginManager;
  private commandRegistry?: CommandRegistry;
  private memoryService?: SessionMemoryService;
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
    sessionRouting?: SessionRoutingService,
    memoryService?: SessionMemoryService
  ) {
    this.eventBus = eventBus;
    this.sessionManager = sessionManager;
    this.contextMode = contextMode;
    this.memoryWindow = memoryWindow;
    this.executionRegistry = new ExecutionRegistry();
    this.sessionRouting = sessionRouting ?? new SessionRoutingService(sessionManager, contextMode);
    this.toolContext = { workspace, eventBus };
    this.memoryService = memoryService;

    const skillsPrompt = skillManager?.buildSkillsPrompt() || '';
    this.executor = new AgentExecutor(
      provider,
      toolRegistry,
      workspace,
      systemPrompt,
      skillsPrompt,
      model,
      maxIterations,
      undefined,
      visionSettings,
      visionProvider,
      this.executionRegistry
    );

    this.backgroundTasks = new BackgroundTaskManager(eventBus);
    this.rebuildExecutionServices();
    this.preprocessingService = new MessagePreprocessingService();

    this.log.info(`Initialized with model: ${model}, contextMode: ${contextMode}, vision: ${visionSettings?.enabled || false}`);
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
    this.executor.setPluginManager(pm);
    this.rebuildExecutionServices();
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
      const history = this.memoryService
        ? await this.memoryService.buildHistory(session)
        : session.messages.slice(-this.memoryWindow);

      this.executor.setCurrentContext(msg.channel, msg.chatId, msg.messageType);
      const messages = this.executor.buildMessages(history, msg.content, msg.media, msg.files);

      if (this.pluginManager) {
        await this.pluginManager.applyOnAgentBefore(msg, messages);
      }

      const executionResult = await this.executionCoordinator.execute({
        sessionKey,
        request: msg,
        messages,
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

  abortExecution(sessionKey: string): boolean {
    const abortedForeground = this.executionRegistry.abort(sessionKey);
    const abortedBackground = this.backgroundTasks.abortTask(sessionKey);
    const aborted = abortedForeground || abortedBackground;

    this.log.info(aborted
      ? `Aborted execution for session: ${sessionKey}`
      : `Abort requested for inactive session: ${sessionKey}`);

    return aborted;
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

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.memoryWindow = memoryWindow;
    this.memoryService = memoryService;
    this.rebuildExecutionServices();
    this.log.info(`Memory settings updated: window=${memoryWindow}, summary=${memoryService ? 'enabled' : 'disabled'}`);
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

  private rebuildExecutionServices(): void {
    this.completionService = new ExecutionCompletionService(
      this.sessionManager,
      this.pluginManager,
      this.memoryService
    );
    this.executionCoordinator = new ExecutionCoordinator(
      this.executor,
      this.backgroundTasks,
      this.completionService
    );
  }

  getCurrentSessionKey(): string | undefined {
    return this.currentSessionKey;
  }

  getSessionKey(channel: string, chatId: string): string | undefined {
    return this.sessionRouting.resolveByChannel(channel, chatId);
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus {
    const foreground = this.executionRegistry.getHandle(sessionKey);
    const background = this.backgroundTasks.getTasksBySessionHandle(sessionKey);

    return {
      sessionKey,
      foreground,
      background,
      active: !!foreground || background.length > 0
    };
  }

  abortSession(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    if (!sessionKey) {
      return false;
    }

    const aborted = this.executionRegistry.abort(sessionKey) || this.backgroundTasks.abortTask(sessionKey);
    if (aborted) {
      this.log.info(`Aborted session: ${sessionKey} (channel: ${channel}, chatId: ${chatId})`);
    }
    return aborted;
  }

  abortBackgroundSession(channel: string, chatId: string): boolean {
    const sessionKey = this.sessionRouting.resolveByChannel(channel, chatId);
    if (!sessionKey) {
      return false;
    }

    const aborted = this.backgroundTasks.abortTask(sessionKey);
    if (aborted) {
      this.log.info(`Aborted background tasks for session: ${sessionKey} (channel: ${channel}, chatId: ${chatId})`);
    }
    return aborted;
  }
}
