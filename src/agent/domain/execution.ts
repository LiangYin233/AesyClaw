export type ExecutionScope = 'chat' | 'session';

export interface SessionExecutionHandle {
  sessionKey: string;
  status: 'running' | 'aborted';
  scope?: ExecutionScope;
  channel?: string;
  chatId?: string;
  startedAt?: Date;
}

export interface ExecutionStatus {
  sessionKey: string;
  current?: SessionExecutionHandle;
  active: boolean;
  channel?: string;
  chatId?: string;
}
