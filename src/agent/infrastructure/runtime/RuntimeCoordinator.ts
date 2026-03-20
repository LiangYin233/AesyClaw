import type { InboundMessage, OutboundMessage } from '../../../types.js';
import type { LLMProvider } from '../../../providers/base.js';
import type { PluginManager } from '../../../plugins/index.js';
import type { ToolRegistry, ToolContext } from '../../../tools/ToolRegistry.js';
import type { SessionManager } from '../../../session/SessionManager.js';
import type { CommandRegistry } from '../../application/index.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { SessionRoutingService } from '../session/SessionRoutingService.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import type { VisionSettings } from '../../../types.js';
import { logger } from '../../../observability/index.js';
import { AgentPipeline } from './AgentPipeline.js';
import { SessionResolver } from '../session/SessionResolver.js';
import { BackgroundTaskManager } from '../execution/BackgroundTaskManager.js';
import { ExecutionEngine } from '../execution/ExecutionEngine.js';
import { ExecutionRuntime } from '../execution/ExecutionRuntime.js';
import { ExecutionRegistry } from '../execution/ExecutionRegistry.js';
import type { ExecutionStatus } from '../../domain/execution.js';
import {
  bindSessionReference,
  mapSessionReference,
  type SessionReference
} from '../../domain/session.js';
import type { EventBus } from '../../../events/EventBus.js';
import type { AesyClawEvents } from '../../../events/events.js';
import { OutboundGateway } from '../../facade/OutboundGateway.js';
import {
  handleDirectMessage,
  handleInboundMessage,
  runAgentTurn,
  type HandleDirectMessageDeps,
  type HandleInboundMessageDeps,
  type RunAgentTurnDeps
} from '../../application/index.js';

const DEFAULT_MAX_ITERATIONS = 40;
const DEFAULT_MEMORY_WINDOW = 50;

export interface RuntimeCoordinatorOptions {
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
  eventBus?: EventBus<AesyClawEvents>;
}

export class RuntimeCoordinator {
  private log = logger.child('RuntimeCoordinator');
  private running = false;
  private defaultProvider: LLMProvider;
  private mainModel: string;
  private systemPrompt: string;
  private maxIterations: number;
  private memoryWindow: number;
  private memoryService?: SessionMemoryService;
  private agentRoleService?: AgentRoleService;
  private readonly pipeline: AgentPipeline;
  private readonly sessionResolver: SessionResolver;
  private readonly executionEngine: ExecutionEngine;
  private readonly executionRuntime: ExecutionRuntime;
  private readonly toolContextBase: ToolContext;
  private readonly handleInboundMessageDeps: HandleInboundMessageDeps;
  private readonly handleDirectMessageDeps: HandleDirectMessageDeps;
  private readonly runAgentTurnDeps: RunAgentTurnDeps;

  constructor(private options: RuntimeCoordinatorOptions) {
    if (!options.model?.trim()) {
      throw new Error('RuntimeCoordinator requires an explicit model');
    }

    this.defaultProvider = options.provider;
    this.mainModel = options.model;
    this.systemPrompt = options.systemPrompt || 'You are a helpful AI assistant.';
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.memoryWindow = options.memoryWindow ?? DEFAULT_MEMORY_WINDOW;
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
    const executionRegistry = new ExecutionRegistry();
    const backgroundTaskManager = new BackgroundTaskManager(
      (message) => this.sendOutbound(message),
      options.eventBus
    );
    this.executionEngine = new ExecutionEngine({
      defaultProvider: options.provider,
      mainModel: this.mainModel,
      defaultSystemPrompt: this.systemPrompt,
      maxIterations: this.maxIterations,
      memoryWindow: this.memoryWindow,
      toolRegistry: options.toolRegistry,
      workspace: options.workspace,
      getPluginManager: options.getPluginManager,
      visionSettings: options.visionSettings,
      visionProvider: options.visionProvider,
      executionRegistry
    }, options.agentRoleService);
    this.executionRuntime = new ExecutionRuntime({
      engine: this.executionEngine,
      sessionRouting: options.sessionRouting,
      sessionManager: options.sessionManager,
      memoryService: options.memoryService,
      getPluginManager: options.getPluginManager,
      sendOutbound: (message) => this.sendOutbound(message),
      executionRegistry,
      backgroundTaskManager
    });
    this.runAgentTurnDeps = {
      executeTurn: async (context) => this.executionRuntime.execute(context)
    };
    this.handleInboundMessageDeps = {
      logInbound: (message) => {
        this.log.info('收到入站消息', {
          sessionKey: message.sessionKey,
          channel: message.channel,
          chatId: message.chatId,
          messageType: message.messageType,
          source: message.metadata?.directResponse ? 'direct' : message.metadata?.source || 'user'
        });
      },
      processInbound: async ({ message, suppressOutbound }) => this.pipeline.process(message, {
        suppressOutbound,
        sendOutbound: async (outbound) => this.sendOutbound(outbound)
      }),
      resolveTurnContext: async ({ message, suppressOutbound, toolContextBase }) => this.sessionResolver.resolve(message, {
        toolContext: {
          ...toolContextBase,
          channel: message.channel,
          chatId: message.chatId,
          messageType: message.messageType
        },
        suppressOutbound,
        memoryWindow: this.memoryWindow
      }),
      runTurn: async (context) => runAgentTurn(this.runAgentTurnDeps, context),
      logCompletion: (context) => {
        this.log.info('入站消息处理完成', {
          sessionKey: context.sessionKey,
          channel: context.channel,
          durationMs: undefined,
          suppressOutbound: context.suppressOutbound
        });
      }
    };
    this.handleDirectMessageDeps = {
      bindMessageToSession: (message, reference) => this.bindMessageToSession(message, reference),
      handleInboundMessage: async (input) => handleInboundMessage(this.handleInboundMessageDeps, input)
    };
  }

  start(): void {
    this.running = true;
    this.log.info('运行时已启动');
  }

  stop(): void {
    this.running = false;
    this.executionRuntime.stop();
  }

  isRunning(): boolean {
    return this.running;
  }

  async handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    const startedAt = Date.now();
    const result = await handleInboundMessage(this.handleInboundMessageDeps, {
      message,
      suppressOutbound: options?.suppressOutbound,
      toolContextBase: this.toolContextBase
    });

    if (result.status === 'handled') {
      this.log.info('入站消息已由处理流水线接管', {
        sessionKey: message.sessionKey,
        channel: message.channel,
        durationMs: Date.now() - startedAt
      });
      return undefined;
    }

    if (result.status === 'replied') {
      this.log.info('入站消息已由处理流水线直接回复', {
        sessionKey: message.sessionKey,
        channel: message.channel,
        durationMs: Date.now() - startedAt
      });
      return result.content;
    }

    this.log.info('入站消息处理完成', {
      sessionKey: message.sessionKey,
      channel: message.channel,
      durationMs: Date.now() - startedAt,
      suppressOutbound: options?.suppressOutbound === true
    });
    return result.content;
  }

  async handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    return handleDirectMessage(this.handleDirectMessageDeps, {
      content,
      reference,
      suppressOutbound: options?.suppressOutbound,
      toolContextBase: this.toolContextBase
    });
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
      return this.executionRuntime.abortByChat(sessionKeyOrChannel, chatId);
    }
    return this.executionRuntime.abortBySessionKey(sessionKeyOrChannel);
  }

  abortReference(reference: SessionReference | string): boolean {
    return mapSessionReference(reference, {
      bySessionKey: (sessionKey) => this.abortSession(sessionKey),
      byChannelChat: (channel, chatId) => this.abortSession(channel, chatId)
    }) ?? false;
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus {
    return this.executionRuntime.getStatus(sessionKey);
  }

  getStatusByReference(reference: SessionReference | string): ExecutionStatus | undefined {
    return mapSessionReference(reference, {
      bySessionKey: (sessionKey) => this.getExecutionStatus(sessionKey),
      byChannelChat: (channel, chatId) => {
        const sessionKey = this.options.sessionRouting.resolveByChannel(channel, chatId);
        return sessionKey ? this.getExecutionStatus(sessionKey) : undefined;
      }
    });
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.defaultProvider = provider;
    if (model) {
      this.mainModel = model;
    }
    this.executionEngine.updateRuntime({
      defaultProvider: provider,
      mainModel: model || this.mainModel
    });
    this.log.info('运行模型配置已更新', { model: model || this.mainModel });
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
    if ('model' in options && !options.model?.trim()) {
      throw new Error('Main agent runtime update requires an explicit model');
    }
    if (options.model) {
      this.mainModel = options.model;
    }
    if (options.systemPrompt !== undefined) {
      this.systemPrompt = options.systemPrompt;
    }
    if (options.maxIterations !== undefined) {
      this.maxIterations = options.maxIterations;
    }

    const runtimeUpdate: Partial<{
      defaultProvider: LLMProvider;
      mainModel: string;
      defaultSystemPrompt: string;
      maxIterations: number;
      visionSettings?: VisionSettings;
      visionProvider?: LLMProvider;
    }> = {};
    if ('provider' in options) {
      runtimeUpdate.defaultProvider = options.provider;
    }
    if ('model' in options) {
      runtimeUpdate.mainModel = options.model;
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
      model: options.model || this.mainModel,
      maxIterations: options.maxIterations || this.maxIterations
    });
  }

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.memoryWindow = memoryWindow;
    this.memoryService = memoryService;
    this.sessionResolver.setMemoryService(memoryService);
    this.executionEngine.updateRuntime({ memoryWindow });
    this.executionRuntime.setMemoryService(memoryService);
    this.log.info('记忆设置已更新', {
      memoryWindow,
      summaryEnabled: !!memoryService
    });
  }

  bindMessageToSession(message: InboundMessage, reference: SessionReference | string): InboundMessage {
    return bindSessionReference(message, reference);
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
