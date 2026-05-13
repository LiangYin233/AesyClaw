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
  Agent: Object.assign(
    vi.fn(function () {
      return {
        buildPrompt: vi.fn(() => ({ prompt: 'system', tools: [] })),
        setRole: agentSetRole,
        process: agentProcess,
      };
    }),
    { resolveActiveRoleId },
  ),
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
    hooksBus: {
      register: vi.fn(),
      unregister: vi.fn(),
      unregisterByPrefix: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      isEnabled: vi.fn(() => false),
      dispatch: vi.fn(async () => ({ action: 'next' as const })),
      clear: vi.fn(),
    },
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
    llmAdapter: {} as never,
    skillManager: {} as never,
    toolRegistry: {} as never,
    compressionThreshold: 0.8,
    agentRegistry: {} as never,
  };
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
    const beforeLLM = vi.fn(async () => ({ action: 'next' as const }));
    const deps = createDeps(session);
    (deps.hooksBus.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (chain: string, _ctx: unknown) => {
        if (chain === 'pipeline:beforeLLM') {
          return await beforeLLM();
        }
        return { action: 'next' as const };
      },
    );
    const pipeline = await createPipeline(deps);
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
    const deps = createDeps(session);

    (deps.hooksBus.dispatch as ReturnType<typeof vi.fn>).mockImplementation(
      async (chain: string, _ctx: unknown) => {
        if (chain === 'pipeline:beforeLLM') {
          return {
            action: 'respond' as const,
            message: { components: [{ type: 'Plain' as const, text: 'hook response' }] },
          };
        }
        return { action: 'next' as const };
      },
    );
    const pipeline = await createPipeline(deps);
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
