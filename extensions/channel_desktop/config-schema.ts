/**
 * channel_desktop — Desktop 频道配置的 TypeBox Schema。
 *
 * 在 init() 中对 ctx.config 做运行时校验，确保配置字段的类型安全，
 * 并提供默认值填充。
 */
import { Type, type Static } from '@sinclair/typebox';

export const DesktopChannelConfigSchema = Type.Object({
  port: Type.Number({ default: 9730 }),
  host: Type.String({ default: '127.0.0.1' }),
  authToken: Type.String({ default: 'desktop-local' }),
});

export type DesktopChannelConfig = Static<typeof DesktopChannelConfigSchema>;
