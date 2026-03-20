import type { InboundMessage } from '../../../src/types.js';
import type { SessionReference } from '../../../src/agent/legacy-types.js';
import type { LLMProvider } from '../../../src/providers/base.js';
import type { SessionMemoryService } from '../../../src/agent/legacy-memory/SessionMemoryService.js';
import type { VisionSettings } from '../../../src/types.js';

export interface RuntimeDepsFake {
  calls: {
    handleDirect: number;
    handleInbound: number;
    abortReference: number;
    getStatusByReference: number;
    runSubAgentTask: number;
    runSubAgentTasks: number;
    abortSession: number;
    updateProvider: number;
    updateMainAgentRuntime: number;
    updateMemorySettings: number;
  };
  lastInbound?: {
    message: InboundMessage;
    options?: { suppressOutbound?: boolean };
  };
  handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string>;
  handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined>;
  runSubAgentTask(
    agentName: string,
    task: string,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<string>;
  runSubAgentTasks(
    tasks: Array<{ agentName: string; task: string }>,
    context?: {
      channel?: string;
      chatId?: string;
      messageType?: 'private' | 'group';
      signal?: AbortSignal;
    }
  ): Promise<Array<{ agentName: string; task: string; success: boolean; result?: string; error?: string }>>;
  abortSession(sessionKeyOrChannel: string, chatId?: string): boolean;
  abortReference(reference: SessionReference | string): boolean;
  getStatusByReference(reference: SessionReference | string): { active: boolean; sessionKey: string } | undefined;
  updateProvider(provider: LLMProvider, model?: string): void;
  updateMainAgentRuntime(options: {
    provider?: LLMProvider;
    model?: string;
    systemPrompt?: string;
    maxIterations?: number;
    visionSettings?: VisionSettings;
    visionProvider?: LLMProvider;
  }): void;
  updateMemorySettings(memoryWindow: number, memoryService?: SessionMemoryService): void;
}

export function buildRuntimeDeps(): RuntimeDepsFake {
  return {
    calls: {
      handleDirect: 0,
      handleInbound: 0,
      abortReference: 0,
      getStatusByReference: 0,
      runSubAgentTask: 0,
      runSubAgentTasks: 0,
      abortSession: 0,
      updateProvider: 0,
      updateMainAgentRuntime: 0,
      updateMemorySettings: 0
    },
    async handleDirect(content) {
      this.calls.handleDirect += 1;
      return `direct:${content}`;
    },
    async handleInbound(message, options) {
      this.calls.handleInbound += 1;
      this.lastInbound = { message, options };
      return `inbound:${message.content}`;
    },
    async runSubAgentTask(agentName, task) {
      this.calls.runSubAgentTask += 1;
      return `${agentName}:${task}`;
    },
    async runSubAgentTasks(tasks) {
      this.calls.runSubAgentTasks += 1;
      return tasks.map((task) => ({
        ...task,
        success: true,
        result: `${task.agentName}:${task.task}`
      }));
    },
    abortSession() {
      this.calls.abortSession += 1;
      return true;
    },
    abortReference() {
      this.calls.abortReference += 1;
      return true;
    },
    getStatusByReference() {
      this.calls.getStatusByReference += 1;
      return {
        active: true,
        sessionKey: 'session-1'
      };
    },
    updateProvider() {
      this.calls.updateProvider += 1;
    },
    updateMainAgentRuntime() {
      this.calls.updateMainAgentRuntime += 1;
    },
    updateMemorySettings() {
      this.calls.updateMemorySettings += 1;
    }
  };
}
