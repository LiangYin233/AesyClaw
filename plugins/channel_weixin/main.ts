import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.ts';
import { WeixinAdapter, type WeixinChannelConfig } from './adapter.ts';

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_weixin',
  channelName: 'weixin',
  create: (config: WeixinChannelConfig) => new WeixinAdapter(config)
};

export default plugin;
