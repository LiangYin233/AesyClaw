import type { OutboundMessage } from '../../../types.js';
import type { ChannelMessage } from './types.js';
import type { ProjectedMessageView } from './projection.js';

export interface OutboundPipelineDeps {
  message: OutboundMessage | ChannelMessage;
  isChannelMessage: (message: OutboundMessage | ChannelMessage) => message is ChannelMessage;
  normalizeChannelMessage: (message: OutboundMessage) => ChannelMessage;
  normalizeExistingChannelMessage: (message: ChannelMessage) => ChannelMessage;
  localizeResources: (message: ChannelMessage) => Promise<ChannelMessage>;
  projectChannelMessage: (message: ChannelMessage) => ProjectedMessageView;
}

export async function prepareOutboundMessage(deps: OutboundPipelineDeps): Promise<ChannelMessage> {
  let message = deps.isChannelMessage(deps.message)
    ? deps.normalizeExistingChannelMessage(deps.message)
    : deps.normalizeChannelMessage(deps.message);

  message = await deps.localizeResources(message);
  const projected = deps.projectChannelMessage(message);
  return { ...message, projection: projected.projection };
}
