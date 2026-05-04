import { describe, expect, it, vi } from 'vitest';
import { SubAgentSandbox } from '../../../src/agent/sub-agent-sandbox';

const ROLE = {
  id: 'researcher',
  name: 'Researcher',
  description: 'Research role',
  systemPrompt: 'You research topics.',
  model: 'openai/gpt-4o',
  toolPermission: { mode: 'allowlist' as const, list: ['*'] },
  skills: ['*'] as ['*'],
  enabled: true,
};

const MOCK_LLM_ADAPTER = {
  resolveModel: vi.fn().mockReturnValue({ contextWindow: 128000 }),
};

describe('SubAgentSandbox', () => {
  it('uses isolated in-memory history for each delegated run', async () => {
    let callCount = 0;
    const agentEngine = {
      runAgentTurn: vi.fn().mockImplementation(() => {
        callCount += 1;
        return Promise.resolve({
          newMessages: [],
          lastAssistant: `history:0-call${callCount}`,
        });
      }),
    };

    const sandbox = new SubAgentSandbox({
      agentEngine,
      roleManager: {
        getRole: vi.fn().mockReturnValue(ROLE),
        getDefaultRole: vi.fn().mockReturnValue(ROLE),
      },
      llmAdapter: MOCK_LLM_ADAPTER,
    });

    await expect(sandbox.runWithRole({ roleId: 'researcher', prompt: 'first' })).resolves.toBe(
      'history:0-call1',
    );
    await expect(sandbox.runWithRole({ roleId: 'researcher', prompt: 'second' })).resolves.toBe(
      'history:0-call2',
    );
    await expect(
      sandbox.runWithPrompt({ systemPrompt: 'Temporary prompt', prompt: 'third' }),
    ).resolves.toBe('history:0-call3');

    expect(agentEngine.runAgentTurn).toHaveBeenCalledTimes(3);
    // All calls should pass empty history (isolated runs)
    for (const call of agentEngine.runAgentTurn.mock.calls) {
      expect(call[0].history).toEqual([]);
    }
  });

  it('applies disabled tools control to sub-agent', async () => {
    const agentEngine = {
      runAgentTurn: vi.fn().mockResolvedValue({
        newMessages: [],
        lastAssistant: 'delegated answer',
      }),
    };
    const roleManager = {
      getRole: vi.fn().mockReturnValue(ROLE),
      getDefaultRole: vi.fn().mockReturnValue(ROLE),
    };
    const sandbox = new SubAgentSandbox({ agentEngine, roleManager, llmAdapter: MOCK_LLM_ADAPTER });

    await expect(
      sandbox.runWithRole({
        roleId: 'researcher',
        prompt: 'bounded',
        enableTools: false,
      }),
    ).resolves.toBe('delegated answer');

    expect(agentEngine.runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        role: expect.objectContaining({
          id: 'researcher',
          toolPermission: { mode: 'allowlist', list: [] },
        }),
        history: [],
        content: 'bounded',
      }),
    );
  });
});
