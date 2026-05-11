import { describe, expect, it, vi } from 'vitest';
import type { Message, RoleConfig, SessionKey } from '../../../src/core/types';
import type { PipelineDependencies } from '../../../src/pipeline/types';
import { AGENT_PROCESSING_BUSY_MESSAGE } from '../../../src/session';

const agentSetRole = vi.fn(async () => undefined);
const agentProcess = vi.fn(async () => ({
  components: [{ type: 'Plain' as const, text: 'agent' }],
}));
const resolveActiveRoleId = vi.fn(async () => undefined);

vi.mock('@aesyclaw/agent/agent', () => ({
  Agent: Object.assign(vi.fn(function () {
    return {
      buildPrompt: vi.fn(() => ({ prompt: 'system', tools: [] })),
      setRole: agentSetRole,
      process: agentProcess,
    };
  }), { resolveActiveRoleId }),
}));

const sessionKey: SessionKey = { channel: 'test', type: 'private', chatId: '1' };
const role: RoleConfig = {
  id: 'default',
  description: 'default role',
  systemPrompt: 'system',
  model: 'provider/model',
  toolPermission: { mode: 'allowlist', list: [] },
  skills: [],
  enabled: true,
};

function createSession(initialLocked = false) {
  let locked = initialLocked;
  return {
    sessionId: 'session-1',
    key: sessionKey,
    get isLocked(): boolean {
      return locked;
    },
    lock: vi.fn(() => {
      if (locked) return false;
      locked = true;
      return true;
    }),
    unlock: vi.fn(() => {
      locked = false;
    }),
  };
}

function createDeps(session: ReturnType<typeof createSession>): PipelineDependencies {
  return {
    sessionManager: {
      create: vi.fn(async () => session),
    },
    commandRegistry: {
      resolve: vi.fn(() => null),
      executeResolved: vi.fn(async () => 'command result'),
    },
    roleManager: {
      getDefaultRole: vi.fn(() => role),
      getRole: vi.fn(() => role),
    },
    databaseManager: {
      roleBindings: {
        getActiveRole: vi.fn(async () => null),
      },
    },
    llmAdapter: {},
    skillManager: {},
    toolRegistry: {},
  } as unknown as PipelineDependencies;
}

async function createPipeline(deps: PipelineDependencies) {
  const { Pipeline } = await import('../../../src/pipeline/pipeline');
  const pipeline = new Pipeline(deps);
  await pipeline.initialize();
  return pipeline;
}

describe('Pipeline', () => {
  it('returns busy for locked non-command messages before beforeLLM hooks run', async () => {
    const session = createSession(true);
    const pipeline = await createPipeline(createDeps(session));
    const beforeLLM = vi.fn(async () => ({ action: 'continue' as const }));
    pipeline.hooks.register('test', { beforeLLM });
    const send = vi.fn(async (_message: Message) => undefined);

    await pipeline.receiveWithSend(
      { components: [{ type: 'Plain', text: 'hello' }] },
      sessionKey,
      undefined,
      send,
    );

    expect(beforeLLM).not.toHaveBeenCalled();
    expect(session.lock).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      components: [{ type: 'Plain', text: AGENT_PROCESSING_BUSY_MESSAGE }],
    });
  });

  it('unlocks when beforeLLM responds after the non-command lock succeeds', async () => {
    const session = createSession(false);
    const pipeline = await createPipeline(createDeps(session));
    pipeline.hooks.register('test', {
      beforeLLM: vi.fn(async () => ({
        action: 'respond' as const,
        components: [{ type: 'Plain' as const, text: 'hook response' }],
      })),
    });
    const send = vi.fn(async (_message: Message) => undefined);

    await pipeline.receiveWithSend(
      { components: [{ type: 'Plain', text: 'hello' }] },
      sessionKey,
      undefined,
      send,
    );

    expect(session.lock).toHaveBeenCalledTimes(1);
    expect(session.unlock).toHaveBeenCalledTimes(1);
    expect(agentProcess).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ components: [{ type: 'Plain', text: 'hook response' }] });
  });
});
