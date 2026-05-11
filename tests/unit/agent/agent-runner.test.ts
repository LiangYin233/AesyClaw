import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamSimple } from '@mariozechner/pi-ai';
import type * as PiAiModule from '@mariozechner/pi-ai';
import { AgentRegistry } from '../../../src/agent/agent-registry';
import { createProviderCacheKey, type AgentRunParams } from '../../../src/agent/runner/agent-runner-protocol';
import { runAgentTask } from '../../../src/agent/runner/agent-runner';

const runnerMock = vi.hoisted(() => {
  function defer<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const instances: Array<{
    state: { messages: unknown[] };
    options: {
      initialState: { model: unknown; messages: unknown[]; tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }> };
      streamFn: (model: unknown, context: unknown, options?: unknown) => unknown;
      sessionId: string;
    };
    promptDeferred: ReturnType<typeof defer<void>>;
    toolResult?: unknown;
    finish: (newMessages?: unknown[]) => void;
  }> = [];

  class MockPiAgent {
    state: { messages: unknown[] };
    options: (typeof instances)[number]['options'];
    promptDeferred = defer<void>();
    toolResult?: unknown;

    constructor(options: MockPiAgent['options']) {
      this.options = options;
      this.state = { messages: [...options.initialState.messages] };
      instances.push(this);
    }

    async prompt(content: string): Promise<void> {
      this.options.streamFn(this.options.initialState.model, { messages: [] }, {
        sessionId: this.options.sessionId,
      });

      if (content === 'call-tool') {
        const tool = this.options.initialState.tools[0];
        if (!tool) throw new Error('Expected a tool');
        this.toolResult = await tool.execute('call_1', {});
        this.state.messages = [
          ...this.options.initialState.messages,
          { role: 'assistant', content: [{ type: 'text', text: 'tool done' }], stopReason: 'stop' },
        ];
        return;
      }

      await this.promptDeferred.promise;
    }

    async waitForIdle(): Promise<void> {}

    finish(newMessages: unknown[] = [
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
    ]): void {
      this.state.messages = [...this.options.initialState.messages, ...newMessages];
      this.promptDeferred.resolve();
    }
  }

  return {
    instances,
    streamSimple: vi.fn(),
    MockPiAgent,
  };
});

vi.mock('@mariozechner/pi-agent-core', () => ({
  Agent: runnerMock.MockPiAgent,
}));

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
  return {
    ...actual,
    streamSimple: runnerMock.streamSimple,
  };
});

function makeRunParams(overrides: Partial<AgentRunParams> = {}): AgentRunParams {
  return {
    roleId: 'assistant',
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
    } as never,
    prompt: 'system',
    tools: [],
    history: [],
    content: 'hello',
    sessionKey: { channel: 'test', type: 'private', chatId: 'runner' },
    compressionThreshold: 0.8,
    registry: new AgentRegistry(),
    ...overrides,
  };
}

describe('agent runner', () => {
  const mockedStreamSimple = vi.mocked(streamSimple);

  beforeEach(() => {
    runnerMock.instances.length = 0;
    runnerMock.streamSimple.mockReset();
    mockedStreamSimple.mockReturnValue({} as ReturnType<typeof streamSimple>);
  });

  it('starts concurrent runs without waiting for earlier runs to finish', async () => {
    const registry = new AgentRegistry();
    const first = runAgentTask(makeRunParams({ registry, content: 'first' }));
    await Promise.resolve();

    const second = runAgentTask(
      makeRunParams({
        registry,
        content: 'second',
        sessionKey: { channel: 'test', type: 'private', chatId: 'runner-2' },
      }),
    );
    await Promise.resolve();

    expect(runnerMock.instances).toHaveLength(2);

    runnerMock.instances[1]?.finish([
      { role: 'assistant', content: [{ type: 'text', text: 'second done' }], stopReason: 'stop' },
    ]);
    runnerMock.instances[0]?.finish([
      { role: 'assistant', content: [{ type: 'text', text: 'first done' }], stopReason: 'stop' },
    ]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ lastAssistant: 'first done' }),
      expect.objectContaining({ lastAssistant: 'second done' }),
    ]);
  });

  it('cancels active runs cooperatively and ignores late model output', async () => {
    const registry = new AgentRegistry();
    const sessionKey = { channel: 'test', type: 'private', chatId: 'runner-cancel' } as const;
    const turn = runAgentTask(makeRunParams({ registry, sessionKey }));
    await Promise.resolve();

    expect(registry.cancel(sessionKey)).toBe(true);

    runnerMock.instances[0]?.finish([
      { role: 'assistant', content: [{ type: 'text', text: 'late' }], stopReason: 'stop' },
    ]);

    await expect(turn).resolves.toEqual({ newMessages: [], lastAssistant: null });
  });

  it('passes cancellation signals to tools and truncates oversized tool results', async () => {
    let receivedSignal: AbortSignal | undefined;
    const turn = runAgentTask(
      makeRunParams({
        content: 'call-tool',
        model: {
          ...makeRunParams().model,
          contextWindow: 100,
        },
        compressionThreshold: 1,
        tools: [
          {
            name: 'big_tool',
            label: 'big_tool',
            description: 'returns too much text',
            parameters: {},
            execute: vi.fn().mockImplementation(async (_toolCallId, _params, signal) => {
              receivedSignal = signal;
              return {
                content: [{ type: 'text', text: 'x'.repeat(400) }],
                details: { source: 'test' },
              };
            }),
          },
        ],
      }),
    );

    await expect(turn).resolves.toMatchObject({ lastAssistant: 'tool done' });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(runnerMock.instances[0]?.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'x'.repeat(192) }],
      details: expect.objectContaining({
        truncated: true,
        originalContentLength: 400,
        truncatedContentLength: 192,
      }),
    });
  });

  it('keeps OpenAI-compatible prompt cache defaults', async () => {
    const turn = runAgentTask(makeRunParams());
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
        sessionId: createProviderCacheKey({ channel: 'test', type: 'private', chatId: 'runner' }),
      }),
    );

    runnerMock.instances[0]?.finish();
    await expect(turn).resolves.toMatchObject({ lastAssistant: 'ok' });
  });
});
