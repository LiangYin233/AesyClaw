import type { AppConfig } from './schema';
import { DEFAULTS } from '../types';

/**
 * 默认应用配置。
 *
 * 当配置文件不存在时用作初始配置，
 * 并作为热重载比较的基线。
 */
export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: DEFAULTS.port,
    host: DEFAULTS.host,
    logLevel: DEFAULTS.logLevel,
  },
  providers: {},
  channels: {},
  agent: {
    memory: {
      compressionThreshold: DEFAULTS.compressionThreshold,
    },
    multimodal: {
      speechToText: {
        provider: 'openai',
        model: 'whisper-1',
      },
      imageUnderstanding: {
        provider: 'openai',
        model: 'gpt-4o',
      },
    },
  },
  mcp: [
    {
      name: 'example',
      transport: 'stdio',
      command: 'node',
      args: ['path/to/server/index.mjs'],
      enabled: false,
    },
  ],
  plugins: [],
};
