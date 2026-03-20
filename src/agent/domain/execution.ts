export interface ExecutionStatus {
  sessionKey: string;
  active: boolean;
  channel?: string;
  chatId?: string;
}
