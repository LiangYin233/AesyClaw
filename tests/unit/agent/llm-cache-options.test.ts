import { describe, expect, it } from 'vitest';
import type { Api, Model, SimpleStreamOptions } from '@mariozechner/pi-ai';
import {
  withDefaultPromptCacheModel,
  withDefaultPromptCacheOptions,
} from '../../../src/agent/llm-cache-options';

function makeModel(api: Api, compat?: unknown): Model<Api> {
  return {
    id: 'test-model',
    name: 'test-model',
    api,
    provider: 'test-provider',
    baseUrl: 'https://example.test/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 8192,
    compat,
  } as Model<Api>;
}

describe('llm-cache-options', () => {
  it('adds OpenAI-compatible prompt cache model defaults', () => {
    expect(withDefaultPromptCacheModel(makeModel('openai-responses')).compat).toMatchObject({
      sendSessionIdHeader: true,
    });
    expect(withDefaultPromptCacheModel(makeModel('openai-completions')).compat).toMatchObject({
      sendSessionAffinityHeaders: true,
    });
  });

  it('preserves explicit prompt cache compat opt-outs', () => {
    expect(
      withDefaultPromptCacheModel(makeModel('openai-responses', { sendSessionIdHeader: false }))
        .compat,
    ).toMatchObject({ sendSessionIdHeader: false });
    expect(
      withDefaultPromptCacheModel(
        makeModel('openai-completions', { sendSessionAffinityHeaders: false }),
      ).compat,
    ).toMatchObject({ sendSessionAffinityHeaders: false });
  });

  it('defaults OpenAI-compatible cache retention without overriding explicit retention', () => {
    const model = makeModel('openai-responses');

    expect(withDefaultPromptCacheOptions(model, { sessionId: 'session:test' })).toMatchObject({
      cacheRetention: 'long',
      sessionId: 'session:test',
    });
    expect(withDefaultPromptCacheOptions(model, { cacheRetention: 'none' })).toMatchObject({
      cacheRetention: 'none',
    });
  });

  it('leaves non-OpenAI-compatible cache settings untouched', () => {
    const model = makeModel('anthropic-messages');
    const options: SimpleStreamOptions = { sessionId: 'session:test' };

    expect(withDefaultPromptCacheModel(model)).toBe(model);
    expect(withDefaultPromptCacheOptions(model, options)).toBe(options);
  });
});
