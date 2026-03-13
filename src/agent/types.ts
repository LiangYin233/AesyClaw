import type { BackgroundTaskHandle } from './execution/BackgroundTaskManager.js';
import type { ForegroundExecutionHandle } from './execution/ExecutionRegistry.js';

export type ContextMode = 'session' | 'channel' | 'global';

export interface ExecutionStatus {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
}

export interface SessionReference {
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  messageType?: 'private' | 'group';
}
