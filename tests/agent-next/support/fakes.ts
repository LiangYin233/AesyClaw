import type { InboundMessage } from '../../../src/types.js';
import type { SessionReference } from '../../../src/agent/types.js';

export interface RuntimeDepsFake {
  calls: {
    handleDirect: number;
    handleInbound: number;
    abortReference: number;
    getStatusByReference: number;
  };
  lastInbound?: {
    message: InboundMessage;
    options?: { suppressOutbound?: boolean };
  };
  handleDirect(
    content: string,
    reference: SessionReference | string,
    options?: { suppressOutbound?: boolean }
  ): Promise<string>;
  handleInbound(
    message: InboundMessage,
    options?: { suppressOutbound?: boolean }
  ): Promise<string | undefined>;
  abortReference(reference: SessionReference | string): boolean;
  getStatusByReference(reference: SessionReference | string): { active: boolean; sessionKey: string } | undefined;
}

export function buildRuntimeDeps(): RuntimeDepsFake {
  return {
    calls: {
      handleDirect: 0,
      handleInbound: 0,
      abortReference: 0,
      getStatusByReference: 0
    },
    async handleDirect(content) {
      this.calls.handleDirect += 1;
      return `direct:${content}`;
    },
    async handleInbound(message, options) {
      this.calls.handleInbound += 1;
      this.lastInbound = { message, options };
      return `inbound:${message.content}`;
    },
    abortReference() {
      this.calls.abortReference += 1;
      return true;
    },
    getStatusByReference() {
      this.calls.getStatusByReference += 1;
      return {
        active: true,
        sessionKey: 'session-1'
      };
    }
  };
}
