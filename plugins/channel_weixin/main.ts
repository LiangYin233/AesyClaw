import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.ts';
import { WeixinAdapter, type WeixinChannelConfig } from './adapter.ts';

export const defaultChannelConfig: Partial<WeixinChannelConfig> = {};

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_weixin',
  channelName: 'weixin',
  create: (config: WeixinChannelConfig) => new WeixinAdapter(config)
};

export default plugin;
