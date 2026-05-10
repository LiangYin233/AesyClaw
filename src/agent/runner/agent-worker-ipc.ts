import type { AgentTool, AgentMessage, ResolvedModel } from '../agent-types';

export type AgentWorkerToolDefinition = Pick<AgentTool, 'name' | 'description' | 'parameters'>;

export type HostToWorkerInitMessage = {
  type: 'init';
  systemPrompt: string;
  model: ResolvedModel;
  apiKey: string;
  tools: AgentWorkerToolDefinition[];
  history: AgentMessage[];
  content: string;
  extraBody: ResolvedModel['extraBody'];
  sessionId: string;
};

export type HostToWorkerToolResultMessage = {
  type: 'toolResult';
  callId: unknown;
  result?: unknown;
  error?: string;
  isError?: true;
};

export type HostToWorkerMessage = HostToWorkerInitMessage | HostToWorkerToolResultMessage;

export type WorkerToHostToolCallMessage = {
  type: 'toolCall';
  callId: unknown;
  toolName: unknown;
  toolCallId: unknown;
  params: unknown;
};

export type WorkerToHostDoneMessage = {
  type: 'done';
  newMessages?: unknown;
  lastAssistant?: unknown;
};

export type WorkerToHostFatalMessage = {
  type: 'fatal';
  message?: unknown;
};

export type WorkerToHostMessage =
  | WorkerToHostDoneMessage
  | WorkerToHostToolCallMessage
  | WorkerToHostFatalMessage;
