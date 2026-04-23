/**
 * Default configuration values.
 *
 * These are used when config.json is missing fields or when
 * subsystems register their own defaults via ConfigManager.registerDefaults().
 */

import type { AppConfig } from './schema';

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
    maxSteps: 10,
  },
  memory: {
    maxContextTokens: 128000,
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
  mcp: [],
  plugins: [],
};