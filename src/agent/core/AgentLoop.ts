import type { LLMMessage, InboundMessage, OutboundMessage, VisionSettings } from '../../types.js';
import type { EventBus } from '../../bus/EventBus.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { PluginManager } from '../../plugins/index.js';
import { SkillManager } from '../../skills/index.js';
import { CommandRegistry } from '../commands/index.js';
import { BackgroundTaskManager, type BackgroundTaskHandle } from '../execution/BackgroundTaskManager.js';
import { SessionRoutingService } from '../session/SessionRoutingService.js';
import { ExecutionRegistry, type ForegroundExecutionHandle } from '../execution/ExecutionRegistry.js';
import { ExecutionFinalizeService } from '../execution/ExecutionFinalizeService.js';
import { MessagePreprocessingService } from '../messaging/MessagePreprocessingService.js';
import { SessionMemoryService } from '../memory/SessionMemoryService.js';
import { AgentRoleService } from '../roles/AgentRoleService.js';
import { logger } from '../../logger/index.js';
import { CONFIG_DEFAULTS } from '../../constants/index.js';
import { ExecutionContextResolver } from '../execution/ExecutionContextResolver.js';
import { ExecutionPolicyFactory } from '../execution/ExecutionPolicyFactory.js';
import { MessageExecutionService } from '../execution/MessageExecutionService.js';
import { ExecutionAbortService, type ExecutionStatusView } from '../execution/ExecutionAbortService.js';
import { MessageIngressService } from '../messaging/MessageIngressService.js';

export type ContextMode = 'session' | 'channel' | 'global';

export interface ExecutionStatus {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export class AgentLoop {
  private running = false;
  private toolContext: ToolContext;
  private currentSessionKey?: string;
  private pluginManager?: PluginManager;
  private commandRegistry?: CommandRegistry;
  private memoryService?: SessionMemoryService;
  private log = logger.child({ prefix: 'Agent' });

  private defaultProvider: LLMProvider;
  private defaultModel: string;
  private systemPrompt: string;
  private maxIterations: number;
  private memoryWindow: number;
  private skillManager?: SkillManager;
  private visionSettings?: VisionSettings;
  private visionProvider?: LLMProvider;
  private agentRoleService?: AgentRoleService;

  private readonly executionRegistry: ExecutionRegistry;
  private readonly backgroundTasks: BackgroundTaskManager;
  private readonly sessionRouting: SessionRoutingService;
  private completionService: ExecutionFinalizeService;
  private preprocessingService: MessagePreprocessingService;
  private contextResolver: ExecutionContextResolver;
  private readonly policyFactory: ExecutionPolicyFactory;
  private readonly executionService: MessageExecutionService;
  private readonly abortService: ExecutionAbortService;
  private ingressService: MessageIngressService;

  constructor(
    private eventBus: EventBus,
    provider: LLMProvider,
    private toolRegistry: ToolRegistry,
    private sessionManager: SessionManager,
    private workspace: string,
    systemPrompt?: string,
    maxIterations: number = CONFIG_DEFAULTS.DEFAULT_MAX_ITERATIONS,
    model: string = 'gpt-4o',
    contextMode: ContextMode = 'channel',
    memoryWindow: number = CONFIG_DEFAULTS.DEFAULT_MEMORY_WINDOW,
    skillManager?: SkillManager,
    visionSettings?: VisionSettings,
    visionProvider?: LLMProvider,
    sessionRouting?: SessionRoutingService,
    memoryService?: SessionMemoryService,
    agentRoleService?: AgentRoleService
  ) {
    this.toolContext = { workspace, eventBus };
    this.defaultProvider = provider;
    this.defaultModel = model;
    this.systemPrompt = systemPrompt || 'You are a helpful AI assistant.';
    this.maxIterations = maxIterations;
    this.memoryWindow = memoryWindow;
    this.skillManager = skillManager;
    this.visionSettings = visionSettings;
    this.visionProvider = visionProvider;
    this.memoryService = memoryService;
    this.agentRoleService = agentRoleService;
    this.executionRegistry = new ExecutionRegistry();
    this.backgroundTasks = new BackgroundTaskManager(eventBus);
    this.sessionRouting = sessionRouting ?? new SessionRoutingService(sessionManager, contextMode);
    this.completionService = new ExecutionFinalizeService(sessionManager, this.pluginManager, memoryService);
    this.preprocessingService = new MessagePreprocessingService();
    this.contextResolver = new ExecutionContextResolver(
      sessionManager,
      this.sessionRouting,
      memoryService,
      agentRoleService
    );
    this.policyFactory = new ExecutionPolicyFactory({
      defaultProvider: provider,
      defaultModel: model,
      defaultSystemPrompt: this.systemPrompt,
      maxIterations,
      memoryWindow,
      toolRegistry,
      workspace,
      pluginManager: this.pluginManager,
      visionSettings,
      visionProvider,
      executionRegistry: this.executionRegistry
    }, agentRoleService);
    this.executionService = new MessageExecutionService(
      this.policyFactory,
      this.backgroundTasks,
      this.completionService,
      this.pluginManager,
      (message) => this.sendOutbound(message)
    );
    this.abortService = new ExecutionAbortService(this.executionRegistry, this.backgroundTasks, this.sessionRouting);
    this.ingressService = new MessageIngressService(this.preprocessingService, this.contextResolver, this.executionService);

    this.log.info('Agent initialized', { model, contextMode, visionEnabled: visionSettings?.enabled || false });
  }

  setPluginManager(pm: PluginManager): void {
    this.pluginManager = pm;
    this.policyFactory.updateRuntime({ pluginManager: pm });
    this.executionService.setPluginManager(pm);
    this.rebuildExecutionServices();
    this.rebuildPreprocessingService();
  }

  setSkillManager(sm: SkillManager): void {
    this.skillManager = sm;
    this.log.debug('Skill manager attached');
  }

  setAgentRoleService(service: AgentRoleService): void {
    this.agentRoleService = service;
    this.rebuildContextResolver();
  }

  async callLLM(
    messages: LLMMessage[],
    options?: { allowTools?: boolean; maxIterations?: number }
  ): Promise<{ content: string; reasoning_content?: string }> {
    const executor = this.policyFactory.createExecutor(
      this.policyFactory.createPolicy(this.agentRoleService?.getDefaultRoleName())
    );
    return executor.callLLM(messages, options);
  }

  async run(): Promise<void> {
    this.running = true;
    this.log.info('Agent loop started');

    while (this.running) {
      try {
        const msg = await this.eventBus.consumeInbound();
        this.log.debug('Inbound message dequeued', { channel: msg.channel, chatId: msg.chatId, messageType: msg.messageType || 'private', sessionKey: msg.sessionKey });
        await this.processMessage(msg);
      } catch (error) {
        if (this.running) {
          this.log.error('Agent loop iteration failed', { error });
        }
      }
    }
  }

  private async processMessage(msg: InboundMessage, suppressOutbound = false): Promise<string | undefined> {
    this.currentSessionKey = msg.sessionKey;

    try {
      return await this.ingressService.processMessage(msg, {
        suppressOutbound,
        toolContext: {
          ...this.toolContext,
          channel: msg.channel,
          chatId: msg.chatId,
          messageType: msg.messageType
        },
        memoryWindow: this.memoryWindow,
        sendOutbound: (message) => this.sendOutbound(message)
      });
    } finally {
      this.currentSessionKey = undefined;
    }
  }

  async runSubAgentTask(
    agentName: string,
    task: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<string> {
    return this.executionService.runSubAgentTask(agentName, task, {
      ...this.toolContext,
      channel: context?.channel,
      chatId: context?.chatId,
      messageType: context?.messageType,
      signal: context?.signal
    }, {
      signal: context?.signal
    });
  }

  async runSubAgentTasks(
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>> {
    return this.executionService.runSubAgentTasks(tasks, {
      ...this.toolContext,
      channel: context?.channel,
      chatId: context?.chatId,
      messageType: context?.messageType,
      signal: context?.signal
    }, {
      signal: context?.signal
    });
  }

  abortExecution(sessionKey: string): boolean {
    const aborted = this.abortService.abortBySessionKey(sessionKey);

    this.log.info(aborted ? 'Execution aborted' : 'Abort requested for inactive session', { sessionKey });

    return aborted;
  }

  async processInbound(msg: InboundMessage, suppressOutbound = true): Promise<string | undefined> {
    return this.processMessage(msg, suppressOutbound);
  }

  async processDirect(
    content: string,
    sessionKey: string,
    contextOverride?: Partial<ToolContext>,
    options?: {
      suppressOutbound?: boolean;
    }
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
        suppressOutbound: options?.suppressOutbound ?? true,
        directResponse: true
      }
    }, options?.suppressOutbound ?? true);

    return response || '';
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.defaultProvider = provider;
    if (model) {
      this.defaultModel = model;
    }
    this.policyFactory.updateRuntime({
      defaultProvider: provider,
      defaultModel: model || this.defaultModel
    });
    this.log.info('Agent provider updated', { model: model || this.defaultModel });
  }

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.memoryWindow = memoryWindow;
    this.memoryService = memoryService;
    this.policyFactory.updateRuntime({ memoryWindow });
    this.rebuildExecutionServices();
    this.rebuildContextResolver();
    this.log.info('Memory settings updated', { memoryWindow, summaryEnabled: !!memoryService });
  }

  private async sendOutbound(msg: OutboundMessage): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.dispatchMessage(msg);
      return;
    }

    await this.eventBus.publishOutbound(msg);
  }

  setCommandRegistry(registry: CommandRegistry): void {
    this.commandRegistry = registry;
    this.rebuildPreprocessingService();
  }

  private rebuildExecutionServices(): void {
    this.completionService = new ExecutionFinalizeService(
      this.sessionManager,
      this.pluginManager,
      this.memoryService
    );
    this.executionService.setCompletionService(this.completionService);
  }

  private rebuildPreprocessingService(): void {
    this.preprocessingService = new MessagePreprocessingService(
      this.commandRegistry,
      this.pluginManager
    );
    this.ingressService.setPreprocessingService(this.preprocessingService);
  }

  private rebuildContextResolver(): void {
    this.contextResolver = new ExecutionContextResolver(
      this.sessionManager,
      this.sessionRouting,
      this.memoryService,
      this.agentRoleService
    );
    this.ingressService = new MessageIngressService(this.preprocessingService, this.contextResolver, this.executionService);
  }

  getCurrentSessionKey(): string | undefined {
    return this.currentSessionKey;
  }

  getSessionKey(channel: string, chatId: string): string | undefined {
    return this.sessionRouting.resolveByChannel(channel, chatId);
  }

  getExecutionStatus(sessionKey: string): ExecutionStatusView {
    return this.abortService.getStatus(sessionKey);
  }

  abortSession(channel: string, chatId: string): boolean {
    const aborted = this.abortService.abortByChat(channel, chatId);
    if (aborted) {
      this.log.info('Chat execution aborted', { channel, chatId });
    }
    return aborted;
  }

  abortBackgroundSession(channel: string, chatId: string): boolean {
    const aborted = this.backgroundTasks.abortTaskByChannel(channel, chatId);
    if (aborted) {
      this.log.info('Background tasks aborted', { channel, chatId });
    }
    return aborted;
  }
}
