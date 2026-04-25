/**
 * LlmAdapter unit tests.
 *
 * Tests cover: resolveModel ("provider/model" format, errors),
 * createGetApiKey, summarize stub, createStreamFn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { completeSimple } from '@mariozechner/pi-ai';
import { LlmAdapter } from '../../../src/agent/llm-adapter';
import type * as PiAiModule from '@mariozechner/pi-ai';
import type { ConfigManager } from '../../../src/core/config/config-manager';
import type { AppConfig } from '../../../src/core/config/schema';

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

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
    multimodal: {
      speechToText: { provider: 'openai', model: 'whisper-1' },
      imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
    },
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
  const mockedCompleteSimple = vi.mocked(completeSimple);

  beforeEach(() => {
    mockedCompleteSimple.mockReset();
    adapter = new LlmAdapter();
    const config = makeConfigWithProviders();
    const configManager = makeMockConfigManager(config);
    adapter.initialize({ configManager });
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

    it('should resolve "anthropic/claude-3-opus" with preset overrides', () => {
      const model = adapter.resolveModel('anthropic/claude-3-opus');

      expect(model.provider).toBe('anthropic');
      expect(model.modelId).toBe('claude-3-opus');
      expect(model.contextWindow).toBe(200000);
      expect(model.reasoning).toBe(true);
      expect(model.apiKey).toBe('sk-ant-test-key');
      expect(model.baseUrl).toBe('https://api.anthropic.com');
      expect(model.apiType).toBe('anthropic-messages');
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
      expect(model.reasoning).toBe(false); // Default
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
      expect(() => adapter.resolveModel('unknown/model')).toThrow(/Provider "unknown" not found/);
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
    it('should generate a summary with the selected role model', async () => {
      const messages = [
        { role: 'user' as const, content: 'Hello', timestamp: Date.now() },
        {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: 'Hi there' }],
          api: 'openai-responses' as const,
          provider: 'openai',
          model: 'gpt-4o',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        },
      ];

      mockedCompleteSimple.mockResolvedValue({
        role: 'assistant',
        content: [
          { type: 'text', text: 'User greeted the assistant and started the conversation.' },
        ],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      });

      const summary = await adapter.summarize(messages, 'openai/gpt-4o', 'session-123');

      expect(summary).toBe('User greeted the assistant and started the conversation.');
      expect(mockedCompleteSimple).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining('Summarize the following conversation'),
            }),
          ],
        }),
        expect.objectContaining({
          apiKey: 'sk-test-key',
          sessionId: 'session-123',
        }),
      );
    });

    it('should throw when the model returns an empty summary', async () => {
      mockedCompleteSimple.mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: '   ' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      });

      await expect(adapter.summarize([], 'openai/gpt-4o')).rejects.toThrow(
        'LLM returned an empty summary',
      );
    });
  });

  describe('analyzeImage', () => {
    it('should call completeSimple with image content and return text', async () => {
      mockedCompleteSimple.mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'A small blue square.' }],
        api: 'openai-responses',
        provider: 'openai',
        model: 'gpt-4o',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      });

      const result = await adapter.analyzeImage(
        'openai/gpt-4o',
        'What is this?',
        { data: 'ZmFrZQ==', mimeType: 'image/png' },
        'session-vision',
      );

      expect(result).toBe('A small blue square.');
      expect(mockedCompleteSimple).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', modelId: 'gpt-4o' }),
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              role: 'user',
              content: [
                { type: 'text', text: 'What is this?' },
                { type: 'image', data: 'ZmFrZQ==', mimeType: 'image/png' },
              ],
            }),
          ],
        }),
        expect.objectContaining({
          apiKey: 'sk-test-key',
          sessionId: 'session-vision',
        }),
      );
    });
  });

  describe('transcribeAudio', () => {
    it('should call the provider transcription endpoint and return text', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ text: 'hello world' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await adapter.transcribeAudio(
        'openai/gpt-4o-audio-preview',
        {
          data: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/wav',
          fileName: 'sample.wav',
        },
        'session-audio',
      );

      expect(result).toBe('hello world');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should reject unsupported provider API types', async () => {
      await expect(
        adapter.transcribeAudio('anthropic/claude-3-opus', {
          data: new Uint8Array([1, 2, 3]),
          mimeType: 'audio/wav',
          fileName: 'sample.wav',
        }),
      ).rejects.toThrow('Speech-to-text is not supported');
    });
  });

  // ─── createStreamFn ──────────────────────────────────────────

  describe('createStreamFn', () => {
    it('should return a stream function', () => {
      const streamFn = adapter.createStreamFn('openai/gpt-4o');

      expect(typeof streamFn).toBe('function');
    });
  });
});
