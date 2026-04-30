import type { AppConfig } from './schema';
import { DEFAULTS } from '../types';

/**
 * Default application configuration.
 *
 * Used as the initial configuration when no config file exists
 * and as the baseline for hot-reload comparisons.
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
