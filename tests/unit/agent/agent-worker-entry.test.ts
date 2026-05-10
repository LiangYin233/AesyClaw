import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamSimple } from '@mariozechner/pi-ai';
import type * as PiAiModule from '@mariozechner/pi-ai';

const workerEntryMock = vi.hoisted(() => {
  class SimplePort {
    messages: unknown[] = [];
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    }

    removeListener(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event);
      if (!list) return;
      this.handlers.set(
        event,
        list.filter((h) => h !== handler),
      );
    }

    emit(event: string, ...args: unknown[]): void {
      const list = this.handlers.get(event) ?? [];
      for (const handler of list) handler(...args);
    }

    postMessage(message: unknown): void {
      this.messages.push(message);
    }
  }

  return {
    parentPort: new SimplePort(),
    streamSimple: vi.fn(),
  };
});

vi.mock('node:worker_threads', () => ({
  parentPort: workerEntryMock.parentPort,
}));

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
  return {
    ...actual,
    streamSimple: workerEntryMock.streamSimple,
  };
});

vi.mock('@mariozechner/pi-agent-core', () => ({
  Agent: class MockPiAgent {
    state: { messages: unknown[] };
    private readonly options: {
      initialState: { model: unknown; messages: unknown[] };
      streamFn: (model: unknown, context: unknown, options?: unknown) => unknown;
      sessionId: string;
    };

    constructor(options: MockPiAgent['options']) {
      this.options = options;
      this.state = { messages: options.initialState.messages };
    }

    async prompt(): Promise<void> {
      this.options.streamFn(this.options.initialState.model, { messages: [] }, {
        sessionId: this.options.sessionId,
      });
    }

    async waitForIdle(): Promise<void> {}
  },
}));

await import('../../../src/agent/runner/agent-worker-entry');

describe('agent worker entry', () => {
  const mockedStreamSimple = vi.mocked(streamSimple);

  beforeEach(() => {
    mockedStreamSimple.mockReset();
    mockedStreamSimple.mockReturnValue({} as ReturnType<typeof streamSimple>);
    workerEntryMock.parentPort.messages.length = 0;
  });

  it('defaults prompt cache settings for OpenAI-compatible worker streams', async () => {
    workerEntryMock.parentPort.emit('message', {
      type: 'init',
      systemPrompt: 'system',
      model: {
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        apiType: 'openai-responses',
        api: 'openai-responses',
        id: 'gpt-4o',
        name: 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
        reasoning: false,
      },
      apiKey: 'sk-test',
      tools: [],
      history: [],
      content: 'hello',
      sessionId: 'session:test:private:worker-entry',
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(mockedStreamSimple).toHaveBeenCalledWith(
      expect.objectContaining({
        api: 'openai-responses',
        compat: expect.objectContaining({ sendSessionIdHeader: true }),
      }),
      { messages: [] },
      expect.objectContaining({
        apiKey: 'sk-test',
        cacheRetention: 'long',
        sessionId: 'session:test:private:worker-entry',
      }),
    );
  });
});
