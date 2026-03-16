import type { InboundMessage, OutboundMessage } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { PluginManager } from '../../plugins/index.js';
import type { ToolRegistry, ToolContext } from '../../tools/ToolRegistry.js';
import type { SessionManager } from '../../session/SessionManager.js';
import type { CommandRegistry } from '../commands/index.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import type { VisionSettings } from '../../types.js';
import { logger } from '../../observability/index.js';
import { CONFIG_DEFAULTS } from '../../constants/index.js';
import { AgentPipeline } from './AgentPipeline.js';
import { SessionResolver } from '../session/SessionResolver.js';
import { ExecutionFinalizer } from '../execution/ExecutionFinalizer.js';
import { ExecutionControl } from '../execution/ExecutionControl.js';
import { ExecutionEngine } from '../execution/ExecutionEngine.js';
import { ExecutionRuntime } from '../execution/ExecutionRuntime.js';
import type { ExecutionStatus, SessionReference } from '../types.js';

export class OutboundGateway {
  private log = logger.child('OutboundGateway');
  private dispatcher?: (message: OutboundMessage) => Promise<void>;

  setDispatcher(dispatcher: (message: OutboundMessage) => Promise<void>): void {
    this.dispatcher = dispatcher;
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.dispatcher) {
      this.log.error('未配置出站消息分发器', {
        channel: message.channel,
        chatId: message.chatId
      });
      throw new Error('Outbound dispatcher not configured');
    }

    await this.dispatcher(message);
  }
}

export interface AgentRuntimeOptions {
  provider: LLMProvider;
  toolRegistry: ToolRegistry;
  sessionManager: SessionManager;
  commandRegistry: CommandRegistry;
  sessionRouting: SessionRoutingService;
  outboundGateway: OutboundGateway;
  workspace: string;
  systemPrompt?: string;
  maxIterations?: number;
  model?: string;
  memoryWindow?: number;
  visionSettings?: VisionSettings;
  visionProvider?: LLMProvider;
  memoryService?: SessionMemoryService;
  agentRoleService?: AgentRoleService;
  getPluginManager: () => PluginManager | undefined;
}

export class AgentRuntime {
  private log = logger.child('AgentRuntime');
  private running = false;
  private defaultProvider: LLMProvider;
  private defaultModel: string;
  private systemPrompt: string;
  private maxIterations: number;
  private memoryWindow: number;
  private memoryService?: SessionMemoryService;
  private agentRoleService?: AgentRoleService;
  private readonly pipeline: AgentPipeline;
  private readonly sessionResolver: SessionResolver;
  private readonly executionControl: ExecutionControl;
  private readonly finalizer: ExecutionFinalizer;
  private readonly executionEngine: ExecutionEngine;
  private readonly executionRuntime: ExecutionRuntime;
  private readonly toolContextBase: ToolContext;

  constructor(private options: AgentRuntimeOptions) {
    this.defaultProvider = options.provider;
    this.defaultModel = options.model || 'gpt-4o';
    this.systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
    this.maxIterations = options.maxIterations ?? CONFIG_DEFAULTS.DEFAULT_MAX_ITERATIONS;
    this.memoryWindow = options.memoryWindow ?? CONFIG_DEFAULTS.DEFAULT_MEMORY_WINDOW;
    this.memoryService = options.memoryService;
    this.agentRoleService = options.agentRoleService;
    this.toolContextBase = { workspace: options.workspace };

    this.pipeline = new AgentPipeline(options.commandRegistry, options.getPluginManager);
    this.sessionResolver = new SessionResolver(
      options.sessionManager,
      options.sessionRouting,
      options.memoryService,
      options.agentRoleService
    );
    this.executionControl = new ExecutionControl(
      options.sessionRouting,
      (message) => options.outboundGateway.send(message)
    );
    this.finalizer = new ExecutionFinalizer(
      options.sessionManager,
      options.getPluginManager,
      options.memoryService
    );
    this.executionEngine = new ExecutionEngine({
      defaultProvider: options.provider,
      defaultModel: this.defaultModel,
      defaultSystemPrompt: this.systemPrompt,
      maxIterations: this.maxIterations,
      memoryWindow: this.memoryWindow,
      toolRegistry: options.toolRegistry,
      workspace: options.workspace,
      getPluginManager: options.getPluginManager,
      visionSettings: options.visionSettings,
      visionProvider: options.visionProvider,
      executionRegistry: this.executionControl.registry
    }, options.agentRoleService);
    this.executionRuntime = new ExecutionRuntime(
      this.executionEngine,
      this.executionControl,
      this.finalizer,
      options.getPluginManager,
      (message) => this.sendOutbound(message)
    );
  }

  start(): void {
    this.running = true;
    this.log.info('运行时已启动');
  }

  stop(): void {
    this.running = false;
    this.executionControl.stop();
  }

  isRunning(): boolean {
    return this.running;
  }

  session(reference: SessionReference | string): SessionHandle {
    return new SessionHandle(this, reference);
  }

  async handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    const startedAt = Date.now();

    this.log.info('收到入站消息', {
      sessionKey: message.sessionKey,
      channel: message.channel,
      chatId: message.chatId,
      messageType: message.messageType,
      source: message.metadata?.directResponse ? 'direct' : message.metadata?.source || 'user'
    });

    const preprocessed = await this.pipeline.process(message, {
      suppressOutbound: options?.suppressOutbound,
      sendOutbound: (outbound) => this.sendOutbound(outbound)
    });

    if (preprocessed.type === 'handled') {
      this.log.info('入站消息已由处理流水线接管', {
        sessionKey: message.sessionKey,
        channel: message.channel,
        durationMs: Date.now() - startedAt
      });
      return undefined;
    }

    if (preprocessed.type === 'reply') {
      this.log.info('入站消息已由处理流水线直接回复', {
        sessionKey: message.sessionKey,
        channel: message.channel,
        durationMs: Date.now() - startedAt
      });
      return preprocessed.content;
    }

    const context = await this.sessionResolver.resolve(preprocessed.message, {
      toolContext: {
        ...this.toolContextBase,
        channel: preprocessed.message.channel,
        chatId: preprocessed.message.chatId,
        messageType: preprocessed.message.messageType
      },
      suppressOutbound: options?.suppressOutbound,
      memoryWindow: this.memoryWindow
    });

    const result = await this.executionRuntime.execute(context);
    this.log.info('入站消息处理完成', {
      sessionKey: context.sessionKey,
      channel: context.channel,
      durationMs: Date.now() - startedAt,
      suppressOutbound: context.suppressOutbound
    });
    return result;
  }

  async handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    const bound = this.bindMessageToSession({
      channel: typeof reference === 'string' ? 'api' : reference.channel || 'api',
      senderId: typeof reference === 'string' ? 'api' : reference.chatId || 'api',
      chatId: typeof reference === 'string' ? reference : reference.chatId || reference.sessionKey || 'api',
      content,
      timestamp: new Date(),
      messageType: typeof reference === 'string' ? 'private' : reference.messageType,
      sessionKey: typeof reference === 'string' ? reference : reference.sessionKey,
      metadata: {
        suppressOutbound: options?.suppressOutbound ?? true,
        directResponse: true
      }
    }, reference);

    const response = await this.handleInbound(bound, {
      suppressOutbound: options?.suppressOutbound ?? true
    });

    return response || '';
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
    return this.executionRuntime.runSubAgentTask(agentName, task, {
      ...this.toolContextBase,
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
    return this.executionRuntime.runSubAgentTasks(tasks, {
      ...this.toolContextBase,
      channel: context?.channel,
      chatId: context?.chatId,
      messageType: context?.messageType,
      signal: context?.signal
    }, {
      signal: context?.signal
    });
  }

  abortSession(sessionKeyOrChannel: string, chatId?: string): boolean {
    if (chatId !== undefined) {
      return this.executionControl.abortByChat(sessionKeyOrChannel, chatId);
    }
    return this.executionControl.abortBySessionKey(sessionKeyOrChannel);
  }

  abortReference(reference: SessionReference | string): boolean {
    if (typeof reference === 'string') {
      return this.abortSession(reference);
    }
    if (reference.sessionKey) {
      return this.abortSession(reference.sessionKey);
    }
    if (reference.channel && reference.chatId) {
      return this.abortSession(reference.channel, reference.chatId);
    }
    return false;
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus {
    return this.executionControl.getStatus(sessionKey);
  }

  getStatusByReference(reference: SessionReference | string): ExecutionStatus | undefined {
    if (typeof reference === 'string') {
      return this.getExecutionStatus(reference);
    }
    if (reference.sessionKey) {
      return this.getExecutionStatus(reference.sessionKey);
    }
    if (reference.channel && reference.chatId) {
      const sessionKey = this.options.sessionRouting.resolveByChannel(reference.channel, reference.chatId);
      return sessionKey ? this.getExecutionStatus(sessionKey) : undefined;
    }
    return undefined;
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.defaultProvider = provider;
    if (model) {
      this.defaultModel = model;
    }
    this.executionEngine.updateRuntime({
      defaultProvider: provider,
      defaultModel: model || this.defaultModel
    });
    this.log.info('运行模型配置已更新', { model: model || this.defaultModel });
  }

  updateMainAgentRuntime(options: {
    provider?: LLMProvider;
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
    visionSettings?: VisionSettings;
    visionProvider?: LLMProvider;
  }): void {
    if (options.provider) {
      this.defaultProvider = options.provider;
    }
    if (options.model) {
      this.defaultModel = options.model;
    }
    if (options.systemPrompt !== undefined) {
      this.systemPrompt = options.systemPrompt;
    }
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }

    const runtimeUpdate: Partial<{
      defaultProvider: LLMProvider;
      defaultModel: string;
      defaultSystemPrompt: string;
      maxIterations: number;
      visionSettings?: VisionSettings;
      visionProvider?: LLMProvider;
    }> = {};
    if ('provider' in options) {
      runtimeUpdate.defaultProvider = options.provider;
    }
    if ('model' in options) {
      runtimeUpdate.defaultModel = options.model;
    }
    if ('systemPrompt' in options) {
      runtimeUpdate.defaultSystemPrompt = options.systemPrompt;
    }
    if ('maxIterations' in options) {
      runtimeUpdate.maxIterations = options.maxIterations;
    }
    if ('visionSettings' in options) {
      runtimeUpdate.visionSettings = options.visionSettings;
    }
    if ('visionProvider' in options) {
      runtimeUpdate.visionProvider = options.visionProvider;
    }

    this.executionEngine.updateRuntime(runtimeUpdate);
    this.log.info('主运行时配置已更新', {
      model: options.model || this.defaultModel,
      maxIterations: options.maxIterations || this.maxIterations
    });
  }

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.memoryWindow = memoryWindow;
    this.memoryService = memoryService;
    this.executionEngine.updateRuntime({ memoryWindow });
    this.log.info('记忆设置已更新', {
      memoryWindow,
      summaryEnabled: !!memoryService
    });
  }

  bindMessageToSession(message: InboundMessage, reference: SessionReference | string): InboundMessage {
    if (typeof reference === 'string') {
      return {
        ...message,
        sessionKey: message.sessionKey || reference
      };
    }

    return {
      ...message,
      sessionKey: message.sessionKey || reference.sessionKey,
      channel: reference.channel || message.channel,
      chatId: reference.chatId || message.chatId,
      senderId: message.senderId || reference.chatId || message.chatId,
      messageType: reference.messageType || message.messageType
    };
  }

  private async sendOutbound(message: OutboundMessage): Promise<void> {
    const pluginManager = this.options.getPluginManager();
    if (pluginManager) {
      await pluginManager.dispatchMessage(message);
      return;
    }

    await this.options.outboundGateway.send(message);
  }
}

export class SessionHandle {
  constructor(
    private runtime: AgentRuntime,
    private reference: SessionReference | string
  ) {}

  async handleMessage(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    const bound = this.runtime.bindMessageToSession(message, this.reference);
    return this.runtime.handleInbound(bound, options);
  }

  async runDirect(
    content: string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    return this.runtime.handleDirect(content, this.reference, options);
  }

  abort(): boolean {
    return this.runtime.abortReference(this.reference);
  }

  status() {
    return this.runtime.getStatusByReference(this.reference);
  }
}
