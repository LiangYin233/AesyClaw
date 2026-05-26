/**
 * channel_weixin — 微信频道配置的 TypeBox Schema。
 *
 * 微信频道的主要凭据（token/baseUrl）通过独立凭据文件管理，
 * 这里仅校验配置中的 enabled 状态。
 */
import { Type, type Static } from '@sinclair/typebox';

export const WeixinChannelConfigSchema = Type.Object({
  enabled: Type.Optional(Type.Boolean({ default: false })),
});

export type WeixinChannelConfig = Static<typeof WeixinChannelConfigSchema>;
