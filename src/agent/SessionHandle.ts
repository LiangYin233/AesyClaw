import type { InboundMessage } from '../types.js';
import type { SessionReference } from './types.js';
import type { AgentRuntime } from './AgentRuntime.js';

export class SessionHandle {
  constructor(
    private runtime: AgentRuntime,
    private reference: SessionReference | string
  ) {}

  async handleMessage(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined> {
    const bound = this.runtime.bindMessageToSession(message, this.reference);
    return this.runtime.handleInbound(bound, options);
  }

  async runDirect(
    content: string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string> {
    return this.runtime.handleDirect(content, this.reference, options);
  }

  abort(): boolean {
    return this.runtime.abortReference(this.reference);
  }

  status() {
    return this.runtime.getStatusByReference(this.reference);
  }
}
