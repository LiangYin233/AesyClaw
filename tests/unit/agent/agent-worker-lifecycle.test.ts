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
    } as never,
    hookDispatcher: {} as never,
  });
}

afterEach(() => {
  Agent.activeAgents.clear();
  (Agent as typeof Agent & { activeWorkers: Map<string, unknown> }).activeWorkers.clear();
  workerMock.instances.length = 0;
});

describe('Agent worker lifecycle', () => {
  it('terminates the previous worker when a new turn starts for the same session', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn1 = agent.runTurn(role, 'first turn', [], agent.session.key);
    await Promise.resolve();

    const turn2 = agent.runTurn(role, 'second turn', [], agent.session.key);
    await Promise.resolve();
    await Promise.resolve();

    expect(getWorker(0).terminateCalls).toBeGreaterThan(0);

    agent.cancel();
    getWorker(0).finishTermination(1);
    getWorker(1).finishTermination(1);

    await expect(turn1).rejects.toThrow('Agent 处理已中止');
    await expect(turn2).rejects.toThrow('Agent 处理已中止');
  });

  it('removes active workers when cancel is called', async () => {
    const agent = makeAgent();
    const role = makeRole();

    const turn = agent.runTurn(role, 'turn', [], agent.session.key);
    await Promise.resolve();

    agent.cancel();
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
