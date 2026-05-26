/**
 * plugin_multimodal — Multimodal 插件配置的 TypeBox Schema。
 *
 * 在 init() 中对 ctx.config 做运行时校验，确保配置字段的类型安全。
 */
import { Type, type Static } from '@sinclair/typebox';

export const MultimodalPluginConfigSchema = Type.Object({
  imageUnderstanding: Type.Optional(
    Type.Object({
      provider: Type.String({ default: 'openai' }),
      model: Type.String({ default: 'gpt-4o' }),
    }),
  ),
  speechToText: Type.Optional(
    Type.Object({
      provider: Type.String({ default: 'openai' }),
      model: Type.String({ default: 'whisper-1' }),
    }),
  ),
});

export type MultimodalPluginConfig = Static<typeof MultimodalPluginConfigSchema>;
