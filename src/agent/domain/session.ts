export interface SessionReference {
  sessionKey?: string;
  channel?: string;
  chatId?: string;
  messageType?: 'private' | 'group';
}
