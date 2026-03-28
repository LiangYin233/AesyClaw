import type { Config, LLMMessage, ToolCall, ToolDefinition } from '../../../types.js';
import type { LogLevel } from '../../../platform/observability/index.js';
import type { ToolContext } from '../../../platform/tools/ToolRegistry.js';
import type {
  WorkerRuntimeEventKind,
  WorkerRuntimeNodeKind,
  WorkerRuntimeToolMode
} from '../../domain/execution.js';

export interface WorkerPolicySnapshot {
  roleName: string;
  model: string;
  systemPrompt: string;
  skillsPrompt: string;
  maxIterations: number;
  maxContextTokens?: number;
  toolDefinitions: ToolDefinition[];
  availableToolDefinitions: ToolDefinition[];
}

export interface StartWorkerExecutionMessage {
  type: 'start_execution';
  executionId: string;
  config: Config;
  policy: WorkerPolicySnapshot;
  messages: LLMMessage[];
  toolContext: ToolContext;
  options?: {
    allowTools?: boolean;
    maxIterations?: number;
    sessionKey?: string;
    source?: 'user' | 'cron';
    initialToolCalls?: ToolCall[];
  };
}

export interface WorkerToolRequestMessage {
  type: 'tool_request';
  executionId: string;
  requestId: string;
  toolName: string;
  params: Record<string, unknown>;
  context: ToolContext;
}

export interface WorkerToolResponseMessage {
  type: 'tool_response';
  executionId: string;
  requestId: string;
  ok: boolean;
  result?: string;
  error?: string;
}

export interface WorkerFinalResultMessage {
  type: 'final_result';
  executionId: string;
  result: {
    content: string;
    reasoning_content?: string;
    toolsUsed: string[];
    agentMode: boolean;
  };
}

export interface WorkerErrorMessage {
  type: 'execution_error';
  executionId: string;
  error: string;
}

export interface WorkerLogMessage {
  type: 'log_event';
  executionId: string;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, unknown>;
}

export interface WorkerLifecycleMessage {
  type: 'worker_lifecycle';
  sessionKey: string;
  executionId: string;
  parentExecutionId?: string;
  kind: WorkerRuntimeNodeKind;
  event: WorkerRuntimeEventKind;
  agentName?: string;
  model?: string;
  childPid?: number | null;
  channel?: string;
  chatId?: string;
  error?: string;
  timestamp?: string;
}

export interface WorkerToolActivityMessage {
  type: 'worker_tool_activity';
  sessionKey: string;
  executionId: string;
  toolName?: string;
  toolMode?: WorkerRuntimeToolMode;
  active: boolean;
  timestamp?: string;
}

export interface WorkerLlmActivityMessage {
  type: 'worker_llm_activity';
  sessionKey: string;
  executionId: string;
  requestId?: string;
  model?: string;
  active: boolean;
  timestamp?: string;
}

export interface AbortWorkerExecutionMessage {
  type: 'abort_execution';
  executionId: string;
}

export type ParentToWorkerMessage =
  | StartWorkerExecutionMessage
  | WorkerToolResponseMessage
  | AbortWorkerExecutionMessage;

export type WorkerToParentMessage =
  | WorkerToolRequestMessage
  | WorkerLogMessage
  | WorkerLifecycleMessage
  | WorkerToolActivityMessage
  | WorkerLlmActivityMessage
  | WorkerFinalResultMessage
  | WorkerErrorMessage;
