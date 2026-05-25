/**
 * plugin_multimodal — Multimodal 插件。
 *
 * 注册 image_understanding 和 speech_to_text 工具。
 * 模型配置（provider + model）从插件 defaultConfig 读取，
 * API 密钥和 baseUrl 通过 ctx.resolveModel() 从核心 config 的 providers 段解析。
 */

import type { PluginDefinition } from '@aesyclaw/sdk';
import { createImageUnderstandingTool } from './image-understanding';
import { createSpeechToTextTool } from './speech-to-text';

const plugin: PluginDefinition = {
  name: 'multimodal',
  version: '0.1.0',
  description: '提供图片理解和语音转文本能力（image_understanding / speech_to_text）',
  defaultConfig: {
    imageUnderstanding: {
      provider: 'openai',
      model: 'gpt-4o',
    },
    speechToText: {
      provider: 'openai',
      model: 'whisper-1',
    },
  },

  async init(ctx) {
    const imgCfg = ctx.config['imageUnderstanding'] as Record<string, string> | undefined;
    const sttCfg = ctx.config['speechToText'] as Record<string, string> | undefined;

    if (imgCfg) {
      ctx.registerTool(
        createImageUnderstandingTool(ctx.resolveModel, {
          provider: imgCfg['provider'] ?? 'openai',
          model: imgCfg['model'] ?? 'gpt-4o',
        }),
      );
    }

    if (sttCfg) {
      ctx.registerTool(
        createSpeechToTextTool(ctx.resolveModel, {
          provider: sttCfg['provider'] ?? 'openai',
          model: sttCfg['model'] ?? 'whisper-1',
        }),
      );
    }

    if (!imgCfg && !sttCfg) {
      ctx.logger.warn('未配置任何 multimodal 工具，请检查插件 config');
    }

    ctx.logger.info('Multimodal plugin initialized');
  },
};

export default plugin;
