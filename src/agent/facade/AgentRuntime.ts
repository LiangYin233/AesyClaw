import type { InboundMessage } from '../../types.js';
import type { ExecutionStatus } from '../domain/execution.js';
import type { AgentRuntimeDeps } from '../domain/ports.js';
import {
  bindSessionReference,
  mapSessionReference,
  type SessionReference
} from '../domain/session.js';
import type { RuntimeLifecycle } from '../domain/runtime.js';
import { SessionHandle } from './SessionHandle.js';
import type { LLMProvider } from '../../providers/base.js';
import type { SessionMemoryService } from '../infrastructure/memory/SessionMemoryService.js';
import type { VisionSettings } from '../../types.js';

export class AgentRuntime {
  private running = false;

  constructor(
    private readonly deps: AgentRuntimeDeps,
    private readonly lifecycle?: RuntimeLifecycle
  ) {}

  start(): void {
    if (this.lifecycle) {
      this.lifecycle.start();
      return;
    }
    this.running = true;
  }

  stop(): void {
    if (this.lifecycle) {
      this.lifecycle.stop();
      return;
    }
    this.running = false;
  }

  isRunning(): boolean {
    if (this.lifecycle) {
      return this.lifecycle.isRunning();
    }
    return this.running;
  }

  session(reference: SessionReference | string): SessionHandle {
    return new SessionHandle(this, reference);
  }

  bindMessageToSession(
    message: InboundMessage,
    reference: SessionReference | string
  ): InboundMessage {
    return bindSessionReference(message, reference);
  }

  async handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    return this.deps.handleInbound(message, options);
  }

  async handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    return this.deps.handleDirect(content, reference, options);
  }

  abortReference(reference: SessionReference | string): boolean {
    if (this.deps.abortReference) {
      return this.deps.abortReference(reference);
    }

    if (!this.deps.abortSession) {
      return false;
    }

    return mapSessionReference(reference, {
      bySessionKey: (sessionKey) => this.deps.abortSession!(sessionKey),
      byChannelChat: (channel, chatId) => this.deps.abortSession!(channel, chatId)
    }) ?? false;
  }

  abortSession(sessionKeyOrChannel: string, chatId?: string): boolean {
    if (!this.deps.abortSession) {
      return false;
    }

    return this.deps.abortSession(sessionKeyOrChannel, chatId);
  }

  getStatusByReference(reference: SessionReference | string): ExecutionStatus | undefined {
    if (this.deps.getStatusByReference) {
      return this.deps.getStatusByReference(reference);
    }

    if (!this.deps.getExecutionStatus) {
      return undefined;
    }

    return mapSessionReference(reference, {
      bySessionKey: (sessionKey) => this.deps.getExecutionStatus!(sessionKey)
    });
  }

  getExecutionStatus(sessionKey: string): ExecutionStatus | undefined {
    return this.deps.getExecutionStatus?.(sessionKey);
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
    if (!this.deps.runSubAgentTask) {
      throw new Error('Sub-agent execution is not configured');
    }

    return this.deps.runSubAgentTask(agentName, task, context);
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
    if (!this.deps.runTemporarySubAgentTask) {
      throw new Error('Temporary sub-agent execution is not configured');
    }

    return this.deps.runTemporarySubAgentTask(baseAgentName, task, systemPrompt, context);
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
    if (!this.deps.runSubAgentTasks) {
      throw new Error('Sub-agent execution is not configured');
    }

    return this.deps.runSubAgentTasks(tasks, context);
  }

  updateProvider(provider: LLMProvider, model?: string): void {
    this.deps.updateProvider?.(provider, model);
  }

  updateMainAgentRuntime(options: {
    provider?: LLMProvider;
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
    visionSettings?: VisionSettings;
    visionProvider?: LLMProvider;
  }): void {
    this.deps.updateMainAgentRuntime?.(options);
  }

  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void {
    this.deps.updateMemorySettings?.(memoryWindow, memoryService);
  }
}
