/**
 * plugin_multimodal — Multimodal 插件。
 *
 * 注册 image_understanding 和 speech_to_text 工具。
 * 模型配置从插件 configSchema 默认值读取，API 密钥和 baseUrl 通过
 * ctx.models.resolve() 从核心 providers 段解析。
 */

import type { PluginDefinition } from '@aesyclaw/sdk';
import { MultimodalPluginConfigSchema, type MultimodalPluginConfig } from './config-schema';
import { createImageUnderstandingTool } from './image-understanding';
import { createSpeechToTextTool } from './speech-to-text';

const plugin: PluginDefinition = {
  name: 'multimodal',
  version: '0.1.0',
  description: '提供图片理解和语音转文本能力（image_understanding / speech_to_text）',
  configSchema: MultimodalPluginConfigSchema,

  async init(ctx) {
    const cfg = ctx.config.self.get<MultimodalPluginConfig>('') ?? {};
    const imgCfg = cfg.imageUnderstanding;
    const sttCfg = cfg.speechToText;

    if (imgCfg) {
      ctx.registry.tools.register(
        createImageUnderstandingTool(ctx.models.resolve, {
          provider: imgCfg['provider'] ?? 'openai',
          model: imgCfg['model'] ?? 'gpt-4o',
        }),
      );
    }

    if (sttCfg) {
      ctx.registry.tools.register(
        createSpeechToTextTool(ctx.models.resolve, {
          provider: sttCfg['provider'] ?? 'openai',
          model: sttCfg['model'] ?? 'whisper-1',
        }),
      );
    }

    if (!imgCfg && !sttCfg) {
      ctx.log.warn('未配置任何 multimodal 工具，请检查插件 config');
    }

    ctx.log.info('Multimodal plugin initialized');
  },
};

export default plugin;
