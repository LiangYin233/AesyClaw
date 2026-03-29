// src/platform/context/WorkerContext.ts
export type WorkerRuntimeNodeKind = 'root' | 'sub-agent' | 'temp-agent';
export type WorkerRuntimeNodeStatus = 'starting' | 'running' | 'aborting' | 'completed' | 'failed';
export type WorkerRuntimeToolMode = 'local' | 'bridge';

export interface WorkerRuntimeNode {
  executionId: string;
  parentExecutionId?: string;
  sessionKey: string;
  kind: WorkerRuntimeNodeKind;
  status: WorkerRuntimeNodeStatus;
  agentName?: string;
  model?: string;
  childPid?: number | null;
  channel?: string;
  chatId?: string;
  error?: string;
  currentToolName?: string;
  currentToolMode?: WorkerRuntimeToolMode;
  currentToolStartedAt?: string;
  lastToolName?: string;
  lastToolMode?: WorkerRuntimeToolMode;
  lastToolFinishedAt?: string;
  currentLlmRequestId?: string;
  currentLlmModel?: string;
  currentLlmStartedAt?: string;
  lastLlmRequestId?: string;
  lastLlmModel?: string;
  lastLlmFinishedAt?: string;
  startedAt: string;
  updatedAt: string;
  children: WorkerRuntimeNode[];
}

export interface WorkerRuntimeSession {
  sessionKey: string;
  channel?: string;
  chatId?: string;
  status: WorkerRuntimeNodeStatus;
  startedAt: string;
  updatedAt: string;
  activeWorkerCount: number;
  totalWorkerCount: number;
  rootExecutionId?: string;
  workers: WorkerRuntimeNode[];
}

export interface WorkerRuntimeSnapshot {
  generatedAt: string;
  activeSessionCount: number;
  activeWorkerCount: number;
  sessions: WorkerRuntimeSession[];
}

export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  options?: {
    imageUrls?: string[];
    replyTo?: number;
  };
}

export interface OutboundGateway {
  setDispatcher(dispatcher: (message: OutboundMessage) => Promise<void>): void;
  send(message: OutboundMessage): Promise<void>;
}
