import type { InboundMessage } from '../../../types.js';
import type { SessionReference } from '../../legacy-types.js';
import type {
  HandleInboundMessageInput,
  HandleInboundMessageResult
} from '../handleInboundMessage/index.js';

export interface HandleDirectMessageDeps {
  bindMessageToSession: (message: InboundMessage, reference: SessionReference | string) => InboundMessage;
  handleInboundMessage: (input: HandleInboundMessageInput) => Promise<HandleInboundMessageResult>;
}
