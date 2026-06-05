/**
 * plugin_md2img — md2img 插件配置的 TypeBox Schema。
 *
 * 在 init() 中对 ctx.config 做运行时校验，确保配置字段的类型安全。
 */
import { Type } from '@sinclair/typebox';

export const Md2ImgPluginConfigSchema = Type.Object({
  enabledChannels: Type.Optional(Type.Array(Type.String(), { default: ['*'] })),
});
