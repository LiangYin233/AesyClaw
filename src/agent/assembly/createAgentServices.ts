import type { AgentRuntimeDeps } from '../domain/ports.js';
import type { RuntimeLifecycle } from '../domain/runtime.js';
import type { SessionReference } from '../domain/session.js';

export interface RuntimeDelegate extends RuntimeLifecycle {
  handleInbound(
    message: Parameters<AgentRuntimeDeps['handleInbound']>[0],
    options?: Parameters<AgentRuntimeDeps['handleInbound']>[1]
  ): ReturnType<AgentRuntimeDeps['handleInbound']>;
  handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string>;
  runSubAgentTask?(
    agentName: string,
    task: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<string>;
  runSubAgentTasks?(
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
  abortSession?(sessionKeyOrChannel: string, chatId?: string): boolean;
  abortReference?(reference: SessionReference | string): boolean;
  getExecutionStatus?(sessionKey: string): ReturnType<NonNullable<AgentRuntimeDeps['getExecutionStatus']>>;
  getStatusByReference?(reference: SessionReference | string): ReturnType<NonNullable<AgentRuntimeDeps['getStatusByReference']>>;
  updateProvider?: AgentRuntimeDeps['updateProvider'];
  updateMainAgentRuntime?: AgentRuntimeDeps['updateMainAgentRuntime'];
  updateMemorySettings?: AgentRuntimeDeps['updateMemorySettings'];
}

export interface AgentRuntimeServices {
  delegate: RuntimeDelegate;
  facadeDeps: AgentRuntimeDeps;
}

export function createAgentServices(delegate: RuntimeDelegate): AgentRuntimeServices {
  return {
    delegate,
    facadeDeps: {
      handleInbound: (message, options) => delegate.handleInbound(message, options),
      handleDirect: (content, reference, options) => delegate.handleDirect(content, reference, options),
      runSubAgentTask: delegate.runSubAgentTask?.bind(delegate),
      runSubAgentTasks: delegate.runSubAgentTasks?.bind(delegate),
      abortSession: delegate.abortSession?.bind(delegate),
      abortReference: delegate.abortReference?.bind(delegate),
      getExecutionStatus: delegate.getExecutionStatus?.bind(delegate),
      getStatusByReference: delegate.getStatusByReference?.bind(delegate),
      updateProvider: delegate.updateProvider?.bind(delegate),
      updateMainAgentRuntime: delegate.updateMainAgentRuntime?.bind(delegate),
      updateMemorySettings: delegate.updateMemorySettings?.bind(delegate)
    }
  };
}
