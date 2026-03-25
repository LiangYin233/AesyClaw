import type { InboundFile, InboundMessage, LLMMessage, ToolCall, VisionSettings } from '../../../types.js';
import type { LLMProvider } from '../../../platform/providers/base.js';
import type { ToolContext, ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { Session, SessionMessage } from '../../../features/sessions/application/SessionManager.js';

export type { VisionSettings } from '../../../types.js';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

export type ExecutionScope = 'chat' | 'session' | 'backgroundTask';

export interface ExecutionHandle {
  sessionKey: string;
  scope: ExecutionScope;
  status: 'running' | 'aborted' | 'completed' | 'failed';
  channel?: string;
  chatId?: string;
  startedAt: Date;
}

export interface ExecutionContext {
  request: InboundMessage;
  sessionKey: string;
  channel: string;
  chatId: string;
  messageType?: 'private' | 'group';
  agentName: string;
  session: Session;
  history: SessionMessage[];
  suppressOutbound: boolean;
  toolContext: ToolContext;
}

export interface ExecutionPolicy {
  roleName: string;
  provider: LLMProvider;
  model: string;
  maxContextTokens?: number;
  systemPrompt: string;
  skillsPrompt: string;
  allowedToolNames: string[];
  toolRegistryView: Pick<ToolRegistry, 'getDefinitions' | 'execute'>;
  visionSettings?: VisionSettings;
  visionProvider?: LLMProvider;
  maxIterations: number;
  memoryWindow: number;
}

export interface ExecutionResult {
  content: string;
  reasoning_content?: string;
  toolsUsed: string[];
  agentMode: boolean;
}

export interface ExecutionOptions {
  allowTools?: boolean;
  maxIterations?: number;
  sessionKey?: string;
  agentName?: string;
  source?: 'user' | 'cron';
  initialToolCalls?: ToolCall[];
  signal?: AbortSignal;
  executionMetadata?: {
    scope?: ExecutionScope;
    channel?: string;
    chatId?: string;
    startedAt?: Date;
  };
}

export interface BackgroundExecutionResult extends ExecutionResult {
  needsBackground: boolean;
  backgroundState?: {
    messages: LLMMessage[];
    toolContext: ToolContext;
    startIndex: number;
  };
}

export interface LLMCallOptions {
  allowTools?: boolean;
  maxIterations?: number;
  reasoning?: boolean;
  signal?: AbortSignal;
}

export interface ExecutionStrategy {
  readonly name: 'sync' | 'background' | 'vision';

  execute(
    messages: LLMMessage[],
    toolContext: ToolContext,
    options: ExecutionOptions
  ): Promise<ExecutionResult>;
}

export function isVisionableFile(file: InboundFile): boolean {
  return file.type === 'image' || IMAGE_EXTENSIONS.some((ext) => file.name?.toLowerCase().endsWith(ext));
}
