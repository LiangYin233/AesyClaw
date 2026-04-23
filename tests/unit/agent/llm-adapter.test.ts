/**
 * LlmAdapter unit tests.
 *
 * Tests cover: resolveModel ("provider/model" format, errors),
 * createGetApiKey, summarize stub, createStreamFn.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LlmAdapter } from '../../../src/agent/llm-adapter';
import type { LlmAdapterDependencies } from '../../../src/agent/llm-adapter';
import type { ConfigManager } from '../../../src/core/config/config-manager';
import type { AppConfig } from '../../../src/core/config/schema';

// ─── Helpers ──────────────────────────────────────────────────────

function makeConfigWithProviders(providers: Record<string, unknown> = {}): AppConfig {
  return {
    server: { port: 3000, host: '0.0.0.0', logLevel: 'info', cors: true },
    providers: {
      openai: {
        apiType: 'openai_responses',
        apiKey: 'sk-test-key',
        models: {
          'gpt-4o': { contextWindow: 128000, enableThinking: false },
          'gpt-4o-mini': { contextWindow: 128000, realModelName: 'gpt-4o-mini-2024-07-18' },
        },
      },
      anthropic: {
        apiType: 'anthropic',
        apiKey: 'sk-ant-test-key',
        baseUrl: 'https://api.anthropic.com',
        models: {
          'claude-3-opus': { contextWindow: 200000, enableThinking: true },
        },
      },
      ...providers,
    },
    channels: {},
    agent: { maxSteps: 10 },
    memory: { maxContextTokens: 128000, compressionThreshold: 0.8 },
    multimodal: { speechToText: { provider: 'openai', model: 'whisper-1' }, imageUnderstanding: { provider: 'openai', model: 'gpt-4o' } },
    mcp: [],
    plugins: [],
  };
}

function makeMockConfigManager(config: AppConfig): ConfigManager {
  return {
    getConfig: () => config,
    get: (key: keyof AppConfig) => config[key],
  } as unknown as ConfigManager;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('LlmAdapter', () => {
  let adapter: LlmAdapter;

  beforeEach(() => {
    adapter = new LlmAdapter();
    const config = makeConfigWithProviders();
    const configManager = makeMockConfigManager(config);
    adapter.initialize({ configManager });
  });

  // ─── resolveModel ────────────────────────────────────────────

  describe('resolveModel', () => {
    it('should resolve "openai/gpt-4o" into a ResolvedModel', () => {
      const model = adapter.resolveModel('openai/gpt-4o');

      expect(model.provider).toBe('openai');
      expect(model.modelId).toBe('gpt-4o');
      expect(model.contextWindow).toBe(128000);
      expect(model.enableThinking).toBe(false);
      expect(model.apiKey).toBe('sk-test-key');
      expect(model.apiType).toBe('openai_responses');
    });

    it('should resolve "anthropic/claude-3-opus" with preset overrides', () => {
      const model = adapter.resolveModel('anthropic/claude-3-opus');

      expect(model.provider).toBe('anthropic');
      expect(model.modelId).toBe('claude-3-opus');
      expect(model.contextWindow).toBe(200000);
      expect(model.enableThinking).toBe(true);
      expect(model.apiKey).toBe('sk-ant-test-key');
      expect(model.baseUrl).toBe('https://api.anthropic.com');
      expect(model.apiType).toBe('anthropic');
    });

    it('should resolve model with realModelName preset', () => {
      const model = adapter.resolveModel('openai/gpt-4o-mini');

      expect(model.modelId).toBe('gpt-4o-mini');
      expect(model.realModelName).toBe('gpt-4o-mini-2024-07-18');
    });

    it('should use provider defaults when no model preset exists', () => {
      const model = adapter.resolveModel('openai/o1-preview');

      expect(model.modelId).toBe('o1-preview');
      expect(model.realModelName).toBeUndefined();
      expect(model.contextWindow).toBe(128000); // Default
      expect(model.enableThinking).toBe(false); // Default
      expect(model.apiKey).toBe('sk-test-key'); // From provider
    });

    it('should use model preset apiKey over provider apiKey', () => {
      const config = makeConfigWithProviders({
        custom: {
          apiType: 'openai_responses',
          apiKey: 'provider-key',
          models: {
            'special-model': { apiKey: 'model-specific-key' },
          },
        },
      });
      const customAdapter = new LlmAdapter();
      customAdapter.initialize({ configManager: makeMockConfigManager(config) });

      const model = customAdapter.resolveModel('custom/special-model');
      expect(model.apiKey).toBe('model-specific-key');
    });

    it('should throw for invalid format (missing slash)', () => {
      expect(() => adapter.resolveModel('invalid-format')).toThrow(
        /Invalid model identifier format/,
      );
    });

    it('should throw for unknown provider', () => {
      expect(() => adapter.resolveModel('unknown/model')).toThrow(
        /Provider "unknown" not found/,
      );
    });

    it('should throw if not initialized', () => {
      const uninitialized = new LlmAdapter();
      expect(() => uninitialized.resolveModel('openai/gpt-4o')).toThrow(
        'LlmAdapter not initialized',
      );
    });
  });

  // ─── createGetApiKey ─────────────────────────────────────────

  describe('createGetApiKey', () => {
    it('should return a function that resolves API keys from config', () => {
      const getApiKey = adapter.createGetApiKey();

      expect(getApiKey('openai')).toBe('sk-test-key');
      expect(getApiKey('anthropic')).toBe('sk-ant-test-key');
    });

    it('should return undefined for unknown provider', () => {
      const getApiKey = adapter.createGetApiKey();
      expect(getApiKey('unknown')).toBeUndefined();
    });

    it('should throw if not initialized', () => {
      const uninitialized = new LlmAdapter();
      expect(() => uninitialized.createGetApiKey()).toThrow('LlmAdapter not initialized');
    });
  });

  // ─── summarize ──────────────────────────────────────────────

  describe('summarize', () => {
    it('should return a stub summary', async () => {
      const messages = [
        { role: 'user' as const, text: 'Hello' },
        { role: 'assistant' as const, text: 'Hi there' },
      ];

      const summary = await adapter.summarize(messages);

      expect(summary).toContain('2 messages');
      expect(summary).toContain('stub');
    });
  });

  // ─── createStreamFn ──────────────────────────────────────────

  describe('createStreamFn', () => {
    it('should return an async generator function', async () => {
      const streamFn = adapter.createStreamFn('openai/gpt-4o');

      expect(typeof streamFn).toBe('function');

      // Call the stream function to get the async iterable
      const iterable = streamFn({}, []);

      // It should be async iterable
      const result = [];
      for await (const chunk of iterable) {
        result.push(chunk);
      }

      expect(result.length).toBeGreaterThan(0);
    });
  });
});