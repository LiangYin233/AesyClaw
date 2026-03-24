import type { ChannelAdapter } from './adapter.js';
import type { InboundMessage } from '../../types.js';
import type { AdapterInboundDraft, ChannelMessage } from './types.js';
import type { ProjectedMessageView } from './projection.js';

export interface InboundPipelineDeps {
  adapter: ChannelAdapter;
  channelName: string;
  rawEvent: unknown;
  draft: AdapterInboundDraft;
  materializeDraft: (channelName: string, draft: AdapterInboundDraft, direction: ChannelMessage['direction']) => ChannelMessage;
  expandQuotes: (adapter: ChannelAdapter, message: ChannelMessage, rawEvent?: unknown) => Promise<ChannelMessage>;
  localizeResources: (message: ChannelMessage) => Promise<ChannelMessage>;
  projectChannelMessage: (message: ChannelMessage) => ProjectedMessageView;
  mapChannelMessageToCompatInbound: (message: ChannelMessage) => InboundMessage;
}

export async function processInboundMessage(deps: InboundPipelineDeps): Promise<InboundMessage> {
  let message = deps.materializeDraft(deps.channelName, deps.draft, 'inbound');
  message = await deps.expandQuotes(deps.adapter, message, deps.rawEvent);
  message = await deps.localizeResources(message);
  const projected = deps.projectChannelMessage(message);
  message = { ...message, projection: projected.projection };
  return deps.mapChannelMessageToCompatInbound(message);
}
