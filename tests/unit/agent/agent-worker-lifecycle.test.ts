import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../../src/agent/agent';
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

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await vi.importActual<typeof import('node:events')>('node:events');

  class MockWorker extends EventEmitter {
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

function activeWorkersSize(): number {
  return (Agent as typeof Agent & { activeWorkers: Map<string, unknown> }).activeWorkers.size;
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

function makeAgent(): Agent {
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
  });
}

afterEach(() => {
  Agent.activeAgents.clear();
  (Agent as typeof Agent & { activeWorkers: Map<string, unknown> }).activeWorkers.clear();
  workerMock.instances.length = 0;
});

describe('Agent worker lifecycle', () => {
  it('uses context window and compression threshold before compacting', async () => {
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
    });
    const role = makeRole();
    await agent.setRole(role);
    vi.spyOn(agent, 'runTurn').mockResolvedValue({ newMessages: [], lastAssistant: 'ok' });

    await agent.process({ components: [{ type: 'Plain', text: 'hello' }] });

    expect(session.compact).not.toHaveBeenCalled();
  });

  it('assigns unique session ids to parallel workers', async () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    const agent = makeAgent();
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
      Agent.cancel(agent.session.key);
      getWorker(0).finishTermination(1);
      getWorker(1).finishTermination(1);
      await Promise.allSettled([turn1, turn2]);
    }
  });

  it('logs when a turn completes', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const agent = makeAgent();
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

  it('keeps parallel workers active for the same session', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn1 = agent.runTurn(role, 'first turn', [], agent.session.key);
    await Promise.resolve();

    const turn2 = agent.runTurn(role, 'second turn', [], agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(getWorker(0).terminateCalls).toBe(0);
      expect(getWorker(1).terminateCalls).toBe(0);
      expect(activeWorkersSize()).toBe(2);
    } finally {
      Agent.cancel(agent.session.key);
      getWorker(0).finishTermination(1);
      getWorker(1).finishTermination(1);
      await Promise.allSettled([turn1, turn2]);
    }
  });

  it('cancels every active worker for the session', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn1 = agent.runTurn(role, 'first turn', [], agent.session.key);
    await Promise.resolve();

    const turn2 = agent.runTurn(role, 'second turn', [], agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    try {
      expect(Agent.cancel(agent.session.key)).toBe(true);
      expect(getWorker(0).terminateCalls).toBeGreaterThan(0);
      expect(getWorker(1).terminateCalls).toBeGreaterThan(0);
      expect(activeWorkersSize()).toBe(0);
    } finally {
      getWorker(0).finishTermination(1);
      getWorker(1).finishTermination(1);
      await Promise.allSettled([turn1, turn2]);
    }
  });

  it('removes active workers when cancel is called', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    Agent.cancel(agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    expect(getWorker(0).terminateCalls).toBeGreaterThan(0);
    expect(activeWorkersSize()).toBe(0);

    getWorker(0).finishTermination(1);

    await expect(turn).rejects.toThrow('Agent 处理已中止');
  });

  it('rejects when the worker emits an error', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    getWorker(0).emit('error', new Error('boom'));

    await expect(turn).rejects.toThrow('Worker 错误: boom');
    expect(getWorker(0).terminateCalls).toBeGreaterThan(0);
    getWorker(0).finishTermination(1);
  });
});
