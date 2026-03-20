import type { InboundMessage } from '../../types.js';
import type { ExecutionStatus } from './execution.js';
import type { SessionReference } from './session.js';

export interface AgentRuntimeDeps {
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
  getStatusByReference(reference: SessionReference | string): ExecutionStatus | undefined;
}
