import type { BackgroundTaskHandle } from './core-execution/BackgroundTaskManager.js';
import type { ForegroundExecutionHandle } from './core-execution/ExecutionRegistry.js';

export type ContextMode = 'session' | 'channel';

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
