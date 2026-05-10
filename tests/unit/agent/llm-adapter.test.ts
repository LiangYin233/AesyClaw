/**
 * LlmAdapter unit tests.
 *
 * Tests cover: resolveModel ("provider/model" format, errors),
 * createStreamFn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { streamSimple } from '@mariozechner/pi-ai';
import { LlmAdapter } from '../../../src/agent/llm-adapter';
import type * as PiAiModule from '@mariozechner/pi-ai';
import type { ConfigManager } from '../../../src/core/config/config-manager';
import type { AppConfig } from '../../../src/core/config/schema';

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
  return {
    ...actual,
    streamSimple: vi.fn(),
  };
});

// ─── Helpers ──────────────────────────────────────────────────────

function makeConfigWithProviders(providers: Record<string, unknown> = {}): AppConfig {
  return {
    server: { port: 3000, host: '0.0.0.0', logLevel: 'info' },
    providers: {
      openai: {
        apiType: 'openai-responses',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        models: {
          'gpt-4o': { contextWindow: 128000 },
          'gpt-4o-mini': { contextWindow: 128000 },
        },
      },
      anthropic: {
        apiType: 'anthropic-messages',
        apiKey: 'sk-ant-test-key',
        baseUrl: 'https://api.anthropic.com',
        models: {
          'claude-3-opus': { contextWindow: 200000 },
        },
      },
      ...providers,
    },
    channels: {},
    agent: {
      memory: { compressionThreshold: 0.8 },
      multimodal: {
        speechToText: { provider: 'openai', model: 'whisper-1' },
        imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
      },
    },
    mcp: [],
    plugins: [],
  };
}

function makeMockConfigManager(config: AppConfig): ConfigManager {
  return {
    get: (path: string): unknown => {
      if (path === 'providers') return config.providers;
      if (path === `providers.${path.split('.')[1]}`) {
        const providerName = path.split('.')[1];
        return config.providers[providerName];
      }
      return undefined;
    },
  } as unknown as ConfigManager;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('LlmAdapter', () => {
  let adapter: LlmAdapter;
  const mockedStreamSimple = vi.mocked(streamSimple);

  beforeEach(async () => {
    mockedStreamSimple.mockReset();
    mockedStreamSimple.mockReturnValue({} as ReturnType<typeof streamSimple>);
    const config = makeConfigWithProviders();
    const configManager = makeMockConfigManager(config);
    adapter = new LlmAdapter(configManager);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ─── resolveModel ────────────────────────────────────────────

  describe('resolveModel', () => {
    it('should resolve "openai/gpt-4o" into a ResolvedModel', () => {
      const model = adapter.resolveModel('openai/gpt-4o');

      expect(model.provider).toBe('openai');
      expect(model.modelId).toBe('gpt-4o');
      expect(model.contextWindow).toBe(128000);
      expect(model.reasoning).toBe(false);
      expect(model.apiKey).toBe('sk-test-key');
      expect(model.apiType).toBe('openai-responses');
      expect(model.id).toBe('gpt-4o');
    });

    it('should resolve "anthropic/claude-3-opus" without deprecated preset overrides', () => {
      const model = adapter.resolveModel('anthropic/claude-3-opus');

      expect(model.provider).toBe('anthropic');
      expect(model.modelId).toBe('claude-3-opus');
      expect(model.contextWindow).toBe(200000);
      expect(model.reasoning).toBe(false);
      expect(model.apiKey).toBe('sk-ant-test-key');
      expect(model.baseUrl).toBe('https://api.anthropic.com');
      expect(model.apiType).toBe('anthropic-messages');
    });

    it('should use provider defaults when no model preset exists', () => {
      const model = adapter.resolveModel('openai/o1-preview');

      expect(model.modelId).toBe('o1-preview');
      expect(model.contextWindow).toBe(128000); // Default
      expect(model.reasoning).toBe(false); // Default
      expect(model.apiKey).toBe('sk-test-key'); // From provider
    });

    it('should not fall back to environment variables when no config apiKey exists', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'env-key-must-not-be-used');
      const config = makeConfigWithProviders({
        custom: {
          apiType: 'openai-responses',
        },
      });
      const customAdapter = new LlmAdapter(makeMockConfigManager(config));

      expect(() => customAdapter.resolveModel('custom/gpt-4o')).toThrow(
        '未为提供者 "custom" 配置 API 密钥',
      );
    });

    it('should throw for invalid format (missing slash)', () => {
      expect(() => adapter.resolveModel('invalid-format')).toThrow(/模型标识符格式无效/);
    });

    it('should throw for unknown provider', () => {
      expect(() => adapter.resolveModel('unknown/model')).toThrow(/配置中未找到提供者/);
    });
  });

  // ─── createStreamFn ──────────────────────────────────────────

  describe('createStreamFn', () => {
    it('should return a stream function', () => {
      const streamFn = adapter.createStreamFn();

      expect(typeof streamFn).toBe('function');
    });

    it('should reject missing model apiKey before provider env fallback can run', () => {
      vi.stubEnv('OPENAI_API_KEY', 'env-key-must-not-be-used');
      const streamFn = adapter.createStreamFn();
      const model = {
        ...adapter.resolveModel('openai/gpt-4o'),
        apiKey: undefined,
      };

      expect(() => streamFn(model, { messages: [] })).toThrow('未为提供者 "openai" 配置 API 密钥');
    });

    it('defaults prompt cache settings for OpenAI Responses stream calls', () => {
      const streamFn = adapter.createStreamFn();
      const model = adapter.resolveModel('openai/gpt-4o');
      const context = { messages: [] };

      streamFn(model, context, { sessionId: 'session:test:private:adapter' });

      expect(mockedStreamSimple).toHaveBeenCalledWith(
        expect.objectContaining({
          api: 'openai-responses',
          compat: expect.objectContaining({ sendSessionIdHeader: true }),
        }),
        context,
        expect.objectContaining({
          apiKey: 'sk-test-key',
          cacheRetention: 'long',
          sessionId: 'session:test:private:adapter',
        }),
      );
    });

    it('defaults prompt cache settings for OpenAI-compatible Completions stream calls', () => {
      const config = makeConfigWithProviders({
        compatible: {
          apiType: 'openai-completions',
          apiKey: 'sk-compatible-test-key',
          baseUrl: 'https://compatible.example/v1',
          models: {
            chat: { contextWindow: 128000 },
          },
        },
      });
      const streamFn = new LlmAdapter(makeMockConfigManager(config)).createStreamFn();
      const model = new LlmAdapter(makeMockConfigManager(config)).resolveModel('compatible/chat');
      const context = { messages: [] };

      streamFn(model, context, { sessionId: 'session:test:private:compatible' });

      expect(mockedStreamSimple).toHaveBeenCalledWith(
        expect.objectContaining({
          api: 'openai-completions',
          compat: expect.objectContaining({ sendSessionAffinityHeaders: true }),
        }),
        context,
        expect.objectContaining({
          apiKey: 'sk-compatible-test-key',
          cacheRetention: 'long',
          sessionId: 'session:test:private:compatible',
        }),
      );
    });

    it('does not default prompt cache settings for non-OpenAI-compatible stream calls', () => {
      const streamFn = adapter.createStreamFn();
      const model = adapter.resolveModel('anthropic/claude-3-opus');

      streamFn(model, { messages: [] });

      expect(mockedStreamSimple).toHaveBeenCalledWith(
        expect.objectContaining({ api: 'anthropic-messages' }),
        { messages: [] },
        expect.not.objectContaining({ cacheRetention: 'long' }),
      );
    });
  });
});
