export type ExecutionScope = 'chat' | 'session' | 'backgroundTask';

export interface ForegroundExecutionHandle {
  sessionKey: string;
  status: 'running' | 'aborted';
  scope?: ExecutionScope;
  channel?: string;
  chatId?: string;
  startedAt?: Date;
}

export interface BackgroundTaskHandle {
  id: string;
  sessionKey: string;
  status: 'pending' | 'running' | 'completed' | 'aborted' | 'failed';
  createdAt: Date;
}

export interface ExecutionStatus {
  sessionKey: string;
  foreground?: ForegroundExecutionHandle;
  background: BackgroundTaskHandle[];
  active: boolean;
  channel?: string;
  chatId?: string;
}
