import type { Config, InboundMessage, OutboundMessage } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { PluginManager } from '../../../features/plugins/index.js';
import type { ToolRegistry, ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { CommandRegistry } from '../../application/index.js';
import type { SessionMemoryService } from '../memory/SessionMemoryService.js';
import type { ISessionRouting } from '../../domain/session.js';
import type { AgentRoleService } from '../roles/AgentRoleService.js';
import type { VisionSettings } from '../../../types.js';
import { DEFAULT_SYSTEM_PROMPT } from '../../../features/config/schema/shared.js';
import { AgentPipeline } from './AgentPipeline.js';
import { SessionResolver } from '../session/SessionResolver.js';
import { ExecutionEngine } from '../execution/ExecutionEngine.js';
import { ExecutionRuntime } from '../execution/ExecutionRuntime.js';
import { ExecutionRegistry } from '../execution/ExecutionRegistry.js';
import { WorkerExecutionDelegateImpl } from '../worker/WorkerExecutionDelegate.js';
import { WorkerRuntimeRegistry } from '../worker/WorkerRuntimeRegistry.js';
import type { ExecutionStatus, WorkerRuntimeSnapshot } from '../../domain/execution.js';
import {
  bindSessionReference,
  mapSessionReference,
  type SessionReference
} from '../../domain/session.js';
import { OutboundGateway } from '../../facade/OutboundGateway.js';
import {
  handleDirectMessage,
  handleInboundMessage,
  type HandleDirectMessageDeps,
  type HandleInboundMessageDeps
} from '../../application/index.js';

const DEFAULT_MAX_ITERATIONS = 40;
const DEFAULT_MEMORY_WINDOW = 50;

export interface RuntimeCoordinatorOptions {
  provider?: LLMProvider;
  toolRegistry: ToolRegistry;
  toolRegistryDefinitions?: Pick<ToolRegistry, 'getDefinitions' | 'execute'>;
  sessionManager: SessionManager;
  commandRegistry: CommandRegistry;
  sessionRouting: ISessionRouting;
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
  getConfig: () => Config;
}

/**
 * 运行时总装配器。
 * 负责把 session 解析、执行引擎、worker delegate 和对外入口收拢成统一门面。
 */
export class RuntimeCoordinator {
  private running = false;
  private defaultProvider?: LLMProvider;
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
  private readonly workerRuntimeRegistry: WorkerRuntimeRegistry;
  private readonly toolContextBase: ToolContext;
  private readonly handleInboundMessageDeps: HandleInboundMessageDeps;
  private readonly handleDirectMessageDeps: HandleDirectMessageDeps;

  constructor(private options: RuntimeCoordinatorOptions) {
    if (!options.model?.trim() && !options.agentRoleService) {
      throw new Error('RuntimeCoordinator requires an explicit model');
    }

    this.defaultProvider = options.provider;
    this.mainModel = options.model?.trim() || '';
    this.systemPrompt = options.systemPrompt || DEFAULT_SYSTEM_PROMPT;
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
    const toolRegistryDefinitions = options.toolRegistryDefinitions ?? options.toolRegistry;
    const executionRegistry = new ExecutionRegistry();
    this.workerRuntimeRegistry = new WorkerRuntimeRegistry();
    // 主执行、子 Agent、临时 Agent 统一复用同一个 worker delegate 与运行态注册表。
    const workerExecutionDelegate = new WorkerExecutionDelegateImpl({
      getConfig: options.getConfig,
      toolRegistry: options.toolRegistry,
      getPluginManager: options.getPluginManager,
      getAvailableToolDefinitions: () => toolRegistryDefinitions.getDefinitions(),
      runtimeRegistry: this.workerRuntimeRegistry
    });
    this.executionEngine = new ExecutionEngine({
      defaultProvider: options.provider,
      mainModel: this.mainModel,
      defaultSystemPrompt: this.systemPrompt,
      maxIterations: this.maxIterations,
      memoryWindow: this.memoryWindow,
      toolRegistry: toolRegistryDefinitions as ToolRegistry,
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
      workerExecutionDelegate
    });
    this.handleInboundMessageDeps = {
      // 前置命令、插件和普通 Agent turn 仍先经过统一 pipeline 分流。
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
      runTurn: async (context) => this.executionRuntime.execute(context)
    };
    this.handleDirectMessageDeps = {
      bindMessageToSession: (message, reference) => this.bindMessageToSession(message, reference),
      handleInboundMessage: async (input) => handleInboundMessage(this.handleInboundMessageDeps, input)
    };
  }

  start(): void {
    this.running = true;
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
    const result = await handleInboundMessage(this.handleInboundMessageDeps, {
      message,
      suppressOutbound: options?.suppressOutbound,
      toolContextBase: this.toolContextBase
    });

    if (result.status === 'handled') {
      return undefined;
    }

    if (result.status === 'replied') {
      return result.content;
    }
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

  async runTemporarySubAgentTask(
    baseAgentName: string | undefined,
    task: string,
    systemPrompt: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<string> {
    return this.executionRuntime.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, {
      ...this.toolContextBase,
      channel: context?.channel,
      chatId: context?.chatId,
      messageType: context?.messageType,
      signal: context?.signal
    }, {
      signal: context?.signal
    });
  }

  async runTemporarySubAgentTasks(
    baseAgentName: string | undefined,
    tasks: Array<{ task: string; systemPrompt: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<Array<{ task: string; success: boolean; result?: string; error?: string }>> {
    return this.executionRuntime.runTemporarySubAgentTasks(baseAgentName, tasks, {
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

  getWorkerRuntimeSnapshot(): WorkerRuntimeSnapshot {
    return this.workerRuntimeRegistry.snapshot();
  }

  onWorkerRuntimeChange(listener: () => void | Promise<void>): () => void {
    return this.workerRuntimeRegistry.onChange(listener);
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
    if ('model' in options) {
      this.mainModel = options.model?.trim() || '';
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
  }

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.memoryWindow = memoryWindow;
    this.memoryService = memoryService;
    this.sessionResolver.setMemoryService(memoryService);
    this.executionEngine.updateRuntime({ memoryWindow });
    this.executionRuntime.setMemoryService(memoryService);
  }

  bindMessageToSession(message: InboundMessage, reference: SessionReference | string): InboundMessage {
    return bindSessionReference(message, reference);
  }

  private async sendOutbound(message: OutboundMessage): Promise<void> {
    const pluginManager = this.options.getPluginManager();
    if (pluginManager) {
      // 若插件接管发送能力，优先走插件侧派发；否则回退到默认 outbound gateway。
      await pluginManager.dispatchMessage(message);
      return;
    }

    await this.options.outboundGateway.send(message);
  }
}
