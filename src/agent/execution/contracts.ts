import type { InboundMessage, VisionSettings } from '../../types.js';
import type { LLMProvider } from '../../providers/base.js';
import type { ToolContext, ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Session, SessionMessage } from '../../session/SessionManager.js';

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
  systemPrompt: string;
  skillsPrompt: string;
  allowedToolNames: string[];
  toolRegistryView: Pick<ToolRegistry, 'getDefinitions' | 'execute'>;
  visionSettings?: VisionSettings;
  maxIterations: number;
  memoryWindow: number;
}
