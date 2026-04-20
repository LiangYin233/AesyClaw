/** @file 频道插件相关类型的 SDK 公共导出
 *
 * 供频道插件开发者 import 使用的统一入口。
 * 使用方式：`import type { ChannelPlugin, ChannelPluginContext } from '@/sdk/channel.js'`
 */
export type {
    ChannelPlugin,
    ChannelPluginContext,
    ChannelSendPayload,
    ChannelPluginLogger,
} from '@/channels/channel-plugin.js';
