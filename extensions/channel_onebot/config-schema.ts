/**
 * channel_onebot — OneBot 渠道配置的 TypeBox Schema。
 *
 * 在 init() 中对 ctx.config 做运行时校验，确保配置字段的类型安全，
 * 并提供默认值填充。
 */
import { Type, type Static } from '@sinclair/typebox';

export const OneBotChannelConfigSchema = Type.Object({
  serverUrl: Type.String({ default: 'ws://127.0.0.1:3001/' }),
  accessToken: Type.Optional(Type.String({ default: '' })),
  allowedChats: Type.Optional(Type.Array(Type.String(), { default: ['*:*'] })),
});

export type OneBotChannelConfig = Static<typeof OneBotChannelConfigSchema>;
