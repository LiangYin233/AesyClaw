import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/agent/agent';
import { AgentRegistry } from '../../../src/agent/agent-registry';
import { runWorkerTask } from '../../../src/agent/worker-runner';
import type { RoleConfig } from '@aesyclaw/core/types';

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const workerMock = vi.hoisted(() => {
  return {
    instances: [] as Array<{
      messages: unknown[];
      terminateCalls: number;
      terminateDeferred: ReturnType<typeof defer<number>>;
      finishTermination: (code?: number) => void;
    }>,
  };
});

vi.mock('node:worker_threads', () => {
  class SimpleEmitter {
    private handlers = new Map<string, Array<(...args: unknown[]) => void>>();

    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
    }

    off(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.handlers.get(event);
      if (list) {
        this.handlers.set(
          event,
          list.filter((h) => h !== handler),
        );
      }
    }

    emit(event: string, ...args: unknown[]): void {
      const list = this.handlers.get(event);
      if (list) {
        for (const handler of list) {
          handler(...args);
        }
      }
    }
  }

  class MockWorker extends SimpleEmitter {
    messages: unknown[] = [];
    terminateCalls = 0;
    terminateDeferred = defer<number>();

    constructor() {
      super();
      workerMock.instances.push(this);
    }

    postMessage(message: unknown): void {
      this.messages.push(message);
    }

    terminate(): Promise<number> {
      this.terminateCalls += 1;
      return this.terminateDeferred.promise;
    }

    finishTermination(code = 1): void {
      this.emit('exit', code);
      this.terminateDeferred.resolve(code);
    }
  }

  return { Worker: MockWorker };
});

function getWorker(index = 0) {
  const worker = workerMock.instances[index];
  if (!worker) {
    throw new Error(`Expected worker at index ${index}`);
  }
  return worker;
}

function getLastToolResultMessage(index = 0) {
  return [...getWorker(index).messages]
    .reverse()
    .find(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'toolResult',
    ) as { result?: { content: Array<{ type: 'text'; text: string }>; details?: unknown } } | undefined;
}

function makeRole(): RoleConfig {
  return {
    id: 'assistant',
    name: 'Assistant',
    description: 'Assistant role',
    systemPrompt: 'You are Assistant.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: [] },
    skills: [],
    enabled: true,
  };
}

let agentRegistry: AgentRegistry;

afterEach(() => {
  agentRegistry = new AgentRegistry();
  workerMock.instances.length = 0;
});

function makeAgent(registry: AgentRegistry = agentRegistry): Agent {
  return new Agent({
    session: {
      key: { channel: 'test', type: 'private', chatId: 'worker-lifecycle' },
    } as never,
    llmAdapter: {
      resolveModel: vi.fn().mockReturnValue({
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        apiType: 'openai-responses',
        id: 'gpt-4o',
        contextWindow: 128000,
        reasoning: false,
      }),
    } as never,
    roleManager: {
      getEnabledRoles: vi.fn().mockReturnValue([]),
      buildSystemPrompt: vi.fn(),
    } as never,
    skillManager: {
      getSkillsForRole: vi.fn().mockReturnValue([]),
    } as never,
    toolRegistry: {
      resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
      getForRole: vi.fn().mockReturnValue([]),
    } as never,
    hookDispatcher: {} as never,
    compressionThreshold: 0.8,
    registry,
  });
}

describe('Agent worker lifecycle', () => {
  it('uses context window and compression threshold before compacting', async () => {
    const registry = new AgentRegistry();
    const session = {
      key: { channel: 'test', type: 'private', chatId: 'compact-threshold' },
      get: vi.fn().mockReturnValue([
        { role: 'user', content: 'x'.repeat(4000) },
        { role: 'assistant', content: [{ type: 'text', text: 'y'.repeat(4000) }] },
        { role: 'user', content: 'z'.repeat(3000) },
      ]),
      compact: vi.fn().mockResolvedValue('summary'),
      syncFromAgent: vi.fn().mockResolvedValue(undefined),
    };
    const agent = new Agent({
      session: session as never,
      llmAdapter: {
        resolveModel: vi.fn().mockReturnValue({
          provider: 'openai',
          modelId: 'gpt-4o',
          apiKey: 'sk-test',
          apiType: 'openai-responses',
          id: 'gpt-4o',
          contextWindow: 4000,
          reasoning: false,
        }),
      } as never,
      roleManager: {
        getEnabledRoles: vi.fn().mockReturnValue([]),
      } as never,
      skillManager: {
        getSkillsForRole: vi.fn().mockReturnValue([]),
      } as never,
      toolRegistry: {
        resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
        getForRole: vi.fn().mockReturnValue([]),
      } as never,
      hookDispatcher: {} as never,
      compressionThreshold: 0.8,
      registry,
    });
    const role = makeRole();
    await agent.setRole(role);
    vi.spyOn(agent, 'runTurn').mockResolvedValue({ newMessages: [], lastAssistant: 'ok' });

    await agent.process({ components: [{ type: 'Plain', text: 'hello' }] });

    expect(session.compact).not.toHaveBeenCalled();
  });

  it('assigns unique session ids to parallel workers', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn1 = agent.runTurn(role, 'first turn', [], agent.session.key);
    await Promise.resolve();

    const turn2 = agent.runTurn(role, 'second turn', [], agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    try {
      const worker1Init = getWorker(0).messages.find(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'init',
      ) as { sessionId?: string } | undefined;
      const worker2Init = getWorker(1).messages.find(
        (message) =>
          typeof message === 'object' &&
          message !== null &&
          (message as { type?: string }).type === 'init',
      ) as { sessionId?: string } | undefined;

      expect(worker1Init?.sessionId).toBeDefined();
      expect(worker2Init?.sessionId).toBeDefined();
      expect(worker1Init?.sessionId).not.toBe(worker2Init?.sessionId);
    } finally {
      dateNow.mockRestore();
      registry.cancel(agent.session.key);
      getWorker(0).finishTermination(1);
      getWorker(1).finishTermination(1);
      await Promise.allSettled([turn1, turn2]);
    }
  });

  it('logs when a turn completes', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'done',
      newMessages: [],
      lastAssistant: 'finished',
    });

    await expect(turn).resolves.toEqual({
      newMessages: [],
      lastAssistant: 'finished',
    });
    expect(infoSpy).toHaveBeenCalled();

    infoSpy.mockRestore();
  });

  it('surfaces the final assistant error instead of earlier tool-call text', async () => {
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'done',
      newMessages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '我先查看网页。' }],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'WebSearch_tavily_extract',
          content: [{ type: 'text', text: 'x'.repeat(210_000) }],
          details: {},
        },
        {
          role: 'assistant',
          content: [],
          stopReason: 'error',
          errorMessage: 'context length exceeded',
        },
      ],
      lastAssistant: '我先查看网页。',
    });

    await expect(turn).resolves.toMatchObject({
      lastAssistant: '[模型错误: context length exceeded]',
    });
  });

  it('does not fall back to earlier assistant text when the final assistant is empty', async () => {
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'done',
      newMessages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '我先查看网页。' }],
          stopReason: 'toolUse',
        },
        {
          role: 'toolResult',
          toolCallId: 'call_1',
          toolName: 'WebSearch_tavily_extract',
          content: [{ type: 'text', text: 'result' }],
          details: {},
        },
        {
          role: 'assistant',
          content: [],
          stopReason: 'stop',
        },
      ],
      lastAssistant: '我先查看网页。',
    });

    await expect(turn).resolves.toMatchObject({
      lastAssistant: null,
    });
  });

  it('truncates successful tool results to half of the remaining compression budget', async () => {
    const registry = new AgentRegistry();
    const turn = runWorkerTask({
      roleId: 'assistant',
      model: {
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        apiType: 'openai-responses',
        id: 'gpt-4o',
        contextWindow: 100,
        reasoning: false,
      } as never,
      prompt: 'system',
      tools: [
        {
          name: 'big_tool',
          label: 'big_tool',
          description: 'returns too much text',
          parameters: {},
          execute: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'x'.repeat(400) }],
            details: { source: 'test' },
          }),
        },
      ],
      history: [{ role: 'user', content: 'h'.repeat(160), timestamp: Date.now() }],
      content: 'u'.repeat(4),
      sessionKey: { channel: 'test', type: 'private', chatId: 'truncate' },
      registry,
      compressionThreshold: 0.8,
    });
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'toolCall',
      callId: 'ipc_1',
      toolName: 'big_tool',
      toolCallId: 'call_1',
      params: {},
    });
    await Promise.resolve();

    const toolResult = getLastToolResultMessage();
    expect(toolResult?.result?.content[0]?.text).toBe('x'.repeat(76));
    expect(toolResult?.result?.details).toMatchObject({
      source: 'test',
      truncated: true,
      originalContentLength: 400,
      truncatedContentLength: 76,
      maxToolResultTokens: 19,
    });

    getWorker(0).emit('message', { type: 'done', newMessages: [], lastAssistant: 'ok' });
    await expect(turn).resolves.toMatchObject({ lastAssistant: 'ok' });
  });

  it('keeps successful tool results that fit within the remaining compression budget', async () => {
    const registry = new AgentRegistry();
    const turn = runWorkerTask({
      roleId: 'assistant',
      model: {
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        apiType: 'openai-responses',
        id: 'gpt-4o',
        contextWindow: 100,
        reasoning: false,
      } as never,
      prompt: 'system',
      tools: [
        {
          name: 'small_tool',
          label: 'small_tool',
          description: 'returns acceptable text',
          parameters: {},
          execute: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'small result' }],
            details: { source: 'test' },
          }),
        },
      ],
      history: [{ role: 'user', content: 'h'.repeat(160), timestamp: Date.now() }],
      content: 'u'.repeat(4),
      sessionKey: { channel: 'test', type: 'private', chatId: 'no-truncate' },
      registry,
      compressionThreshold: 0.8,
    });
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'toolCall',
      callId: 'ipc_1',
      toolName: 'small_tool',
      toolCallId: 'call_1',
      params: {},
    });
    await Promise.resolve();

    const toolResult = getLastToolResultMessage();
    expect(toolResult?.result?.content[0]?.text).toBe('small result');
    expect(toolResult?.result?.details).toEqual({ source: 'test' });

    getWorker(0).emit('message', { type: 'done', newMessages: [], lastAssistant: 'ok' });
    await expect(turn).resolves.toMatchObject({ lastAssistant: 'ok' });
  });

  it('does not truncate tool error results', async () => {
    const registry = new AgentRegistry();
    const turn = runWorkerTask({
      roleId: 'assistant',
      model: {
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test',
        apiType: 'openai-responses',
        id: 'gpt-4o',
        contextWindow: 100,
        reasoning: false,
      } as never,
      prompt: 'system',
      tools: [
        {
          name: 'error_tool',
          label: 'error_tool',
          description: 'returns an error',
          parameters: {},
          execute: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'e'.repeat(400) }],
            details: {},
            isError: true,
          }),
        },
      ],
      history: [{ role: 'user', content: 'h'.repeat(160), timestamp: Date.now() }],
      content: 'u'.repeat(4),
      sessionKey: { channel: 'test', type: 'private', chatId: 'error-not-truncated' },
      registry,
      compressionThreshold: 0.8,
    });
    await Promise.resolve();

    getWorker(0).emit('message', {
      type: 'toolCall',
      callId: 'ipc_1',
      toolName: 'error_tool',
      toolCallId: 'call_1',
      params: {},
    });
    await Promise.resolve();

    const toolResult = getLastToolResultMessage();
    expect(toolResult).toMatchObject({
      error: JSON.stringify([{ type: 'text', text: 'e'.repeat(400) }]),
      isError: true,
    });

    getWorker(0).emit('message', { type: 'done', newMessages: [], lastAssistant: 'ok' });
    await expect(turn).resolves.toMatchObject({ lastAssistant: 'ok' });
  });

  it('cancels every active worker for the session', async () => {
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn1 = agent.runTurn(role, 'first turn', [], agent.session.key);
    await Promise.resolve();

    const turn2 = agent.runTurn(role, 'second turn', [], agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(registry.cancel(agent.session.key)).toBe(true);
      expect(getWorker(0).terminateCalls).toBeGreaterThan(0);
      expect(getWorker(1).terminateCalls).toBeGreaterThan(0);
    } finally {
      getWorker(0).finishTermination(1);
      getWorker(1).finishTermination(1);
      await Promise.allSettled([turn1, turn2]);
    }
  });

  it('removes active workers when cancel is called', async () => {
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    registry.cancel(agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    expect(getWorker(0).terminateCalls).toBeGreaterThan(0);

    getWorker(0).finishTermination(1);

    await expect(turn).rejects.toThrow('Agent 处理已中止');
  });

  it('rejects when the worker emits an error', async () => {
    const registry = new AgentRegistry();
    const agent = makeAgent(registry);
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    getWorker(0).emit('error', new Error('boom'));

    await expect(turn).rejects.toThrow('Worker 错误: boom');
    expect(getWorker(0).terminateCalls).toBeGreaterThan(0);
    getWorker(0).finishTermination(1);
  });
});
