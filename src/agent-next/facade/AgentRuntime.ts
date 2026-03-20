import type { InboundMessage } from '../../types.js';
import type { ExecutionStatus } from '../domain/execution.js';
import type { AgentRuntimeDeps } from '../domain/ports.js';
import type { SessionReference } from '../domain/session.js';
import { SessionHandle } from './SessionHandle.js';

export class AgentRuntime {
  private running = false;

  constructor(private readonly deps: AgentRuntimeDeps) {}

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  session(reference: SessionReference | string): SessionHandle {
    return new SessionHandle(this, reference);
  }

  bindMessageToSession(
    message: InboundMessage,
    reference: SessionReference | string
  ): InboundMessage {
    if (typeof reference === 'string') {
      return {
        ...message,
        sessionKey: message.sessionKey || reference
      };
    }

    return {
      ...message,
      sessionKey: message.sessionKey || reference.sessionKey,
      channel: reference.channel || message.channel,
      chatId: reference.chatId || message.chatId,
      senderId: message.senderId || reference.chatId || message.chatId,
      messageType: reference.messageType || message.messageType
    };
  }

  async handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    return this.deps.handleInbound(message, options);
  }

  async handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    return this.deps.handleDirect(content, reference, options);
  }

  abortReference(reference: SessionReference | string): boolean {
    return this.deps.abortReference(reference);
  }

  getStatusByReference(reference: SessionReference | string): ExecutionStatus | undefined {
    return this.deps.getStatusByReference(reference);
  }
}
