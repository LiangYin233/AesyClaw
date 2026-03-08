import { OneBotChannel } from './OneBotChannel.js';
import { FeishuChannel } from './FeishuChannel.js';

export { BaseChannel } from './BaseChannel.js';
export { OneBotChannel } from './OneBotChannel.js';
export type { OneBotConfig } from './OneBotChannel.js';
export { FeishuChannel } from './FeishuChannel.js';
export type { FeishuConfig } from './FeishuChannel.js';
export { ChannelManager } from './ChannelManager.js';
export type { ChannelPlugin } from './ChannelManager.js';

OneBotChannel.register();
FeishuChannel.register();
