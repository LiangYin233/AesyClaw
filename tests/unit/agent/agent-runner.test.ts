import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamSimple } from '@mariozechner/pi-ai';
import type * as PiAiModule from '@mariozechner/pi-ai';
import { AgentRegistry } from '../../../src/agent/agent-registry';
import {
  createProviderCacheKey,
  type AgentRunParams,
} from '../../../src/agent/runner/agent-runner';
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

  const instances: MockPiAgent[] = [];

  type MockAgentOptions = {
    initialState: {
      model: unknown;
      messages: unknown[];
      tools: Array<{ execute: (...args: unknown[]) => Promise<unknown> }>;
    };
    streamFn: (model: unknown, context: unknown, options?: unknown) => unknown;
    sessionId: string;
    afterToolCall?: (
      context: {
        result: unknown;
        isError: boolean;
        toolCall: { id: string; name: string };
        args: unknown;
        context: unknown;
      },
      signal?: AbortSignal,
    ) => Promise<Record<string, unknown> | undefined>;
  };

  class MockPiAgent {
    state: { messages: unknown[] };
    options: MockAgentOptions;
    promptDeferred = defer<void>();
    rawToolResult?: unknown;
    toolResult?: unknown;
    afterToolCallCalls: Array<{ result: unknown; override: unknown }> = [];
    abort = vi.fn(() => {
      this.abortController.abort();
    });
    waitForIdle = vi.fn(async () => {});
    private readonly abortController = new AbortController();

    constructor(options: MockPiAgent['options']) {
      this.options = options;
      this.state = { messages: [...options.initialState.messages] };
      instances.push(this);
    }

    async prompt(content: string): Promise<void> {
      this.options.streamFn(
        this.options.initialState.model,
        { messages: [] },
        {
          sessionId: this.options.sessionId,
        },
      );

      if (content === 'call-tool') {
        const tool = this.options.initialState.tools[0];
        if (!tool) throw new Error('Expected a tool');
        const rawResult = await tool.execute('call_1', {}, this.abortController.signal);
        this.rawToolResult = rawResult;
        const resultRecord = rawResult as Record<string, unknown>;
        const override = await this.options.afterToolCall?.(
          {
            result: rawResult,
            isError: resultRecord['isError'] === true,
            toolCall: { id: 'call_1', name: 'big_tool' },
            args: {},
            context: { messages: this.state.messages, tools: this.options.initialState.tools },
          },
          this.abortController.signal,
        );
        this.afterToolCallCalls.push({ result: rawResult, override });
        this.toolResult = override ? { ...resultRecord, ...override } : rawResult;
        this.state.messages = [
          ...this.options.initialState.messages,
          { role: 'assistant', content: [{ type: 'text', text: 'tool done' }], stopReason: 'stop' },
        ];
        return;
      }

      await this.promptDeferred.promise;
    }

    finish(
      newMessages: unknown[] = [
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' },
      ],
    ): void {
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
    expect(runnerMock.instances[0]?.abort).toHaveBeenCalledTimes(1);

    runnerMock.instances[0]?.finish([
      { role: 'assistant', content: [{ type: 'text', text: 'late' }], stopReason: 'stop' },
    ]);

    await expect(turn).resolves.toEqual({ newMessages: [], lastAssistant: null, cancelled: true });
  });

  it('passes PiAgent cancellation signals to tools and trims oversized successful tool results after execution', async () => {
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
      content: [{ type: 'text', text: 'x'.repeat(168) }],
      details: expect.objectContaining({
        truncated: true,
        originalContentLength: 400,
        truncatedContentLength: 168,
      }),
    });
    expect(runnerMock.instances[0]?.rawToolResult).toMatchObject({
      content: [{ type: 'text', text: 'x'.repeat(400) }],
      details: { source: 'test' },
    });
    expect(runnerMock.instances[0]?.afterToolCallCalls).toHaveLength(1);
    expect(runnerMock.instances[0]?.afterToolCallCalls[0]?.override).toMatchObject({
      content: [{ type: 'text', text: 'x'.repeat(168) }],
      details: expect.objectContaining({
        truncated: true,
        originalContentLength: 400,
        truncatedContentLength: 168,
      }),
    });
  });

  it('does not trim oversized tool error results in afterToolCall', async () => {
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
            description: 'returns too much error text',
            parameters: {},
            execute: vi.fn().mockResolvedValue({
              content: [{ type: 'text', text: 'e'.repeat(400) }],
              details: { source: 'test' },
              isError: true,
            }),
          },
        ],
      }),
    );

    await expect(turn).resolves.toMatchObject({ lastAssistant: 'tool done' });
    expect(runnerMock.instances[0]?.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'e'.repeat(400) }],
      details: { source: 'test' },
      isError: true,
    });
  });

  it('waits for PiAgent idle before returning successful runs', async () => {
    const turn = runAgentTask(makeRunParams());
    await Promise.resolve();

    runnerMock.instances[0]?.finish();

    await expect(turn).resolves.toMatchObject({ lastAssistant: 'ok' });
    expect(runnerMock.instances[0]?.waitForIdle).toHaveBeenCalledTimes(1);
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
