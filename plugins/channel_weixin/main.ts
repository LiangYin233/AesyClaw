import type { ChannelPluginDefinition } from '../../src/channels/ChannelManager.ts';
import { WeixinAdapter, type WeixinChannelConfig } from './adapter.ts';

const plugin: ChannelPluginDefinition = {
  pluginName: 'channel_weixin',
  channelName: 'weixin',
  create: (config: WeixinChannelConfig, workspace?: string) => new WeixinAdapter(config, workspace || process.cwd())
};

export default plugin;
