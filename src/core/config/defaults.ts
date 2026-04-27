import type { AppConfig } from './schema';

/**
 * Default application configuration.
 *
 * Used as the initial configuration when no config file exists
 * and as the baseline for hot-reload comparisons.
 */
export const DEFAULT_CONFIG: AppConfig = {
  server: {
    port: 3000,
    host: '0.0.0.0',
    logLevel: 'info',
    cors: true,
  },
  providers: {},
  channels: {},
  agent: {
    memory: {
      compressionThreshold: 0.8,
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
  mcp: [],
  plugins: [],
};
