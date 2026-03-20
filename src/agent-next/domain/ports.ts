import type { InboundMessage } from '../../types.js';
import type { ExecutionStatus } from './execution.js';
import type { SessionReference } from './session.js';
import type { LLMProvider } from '../../providers/base.js';
import type { SessionMemoryService } from '../../agent/memory/SessionMemoryService.js';
import type { VisionSettings } from '../../types.js';

export interface AgentRuntimeDeps {
  handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string>;
  handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined>;
  abortReference?(reference: SessionReference | string): boolean;
  abortSession?(sessionKeyOrChannel: string, chatId?: string): boolean;
  getStatusByReference?(reference: SessionReference | string): ExecutionStatus | undefined;
  getExecutionStatus?(sessionKey: string): ExecutionStatus | undefined;
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
  updateProvider?(provider: LLMProvider, model?: string): void;
  updateMainAgentRuntime?(options: {
    provider?: LLMProvider;
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
    visionSettings?: VisionSettings;
    visionProvider?: LLMProvider;
  }): void;
  updateMemorySettings?(memoryWindow: number, memoryService?: SessionMemoryService): void;
}
