import { describe, expect, it, vi } from 'vitest';
import { createPersistedAssistantMessage, createUserMessage } from '../../../src/agent/agent-types';
import { SubAgentSandbox } from '../../../src/agent/sub-agent-sandbox';
import { getInboundMessageText } from '../../../src/core/types';

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
    const agentEngine = {
      createAgent: vi.fn().mockReturnValue({ state: {} }),
      process: vi.fn().mockImplementation(async (_agent, message, memory) => {
        const historyBefore = await memory.loadHistory();
        await memory.syncFromAgent([
          createUserMessage(getInboundMessageText(message)),
          createPersistedAssistantMessage('delegated answer'),
        ]);

        return { content: `history:${historyBefore.length}` };
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
      'history:0',
    );
    await expect(sandbox.runWithRole({ roleId: 'researcher', prompt: 'second' })).resolves.toBe(
      'history:0',
    );
    await expect(
      sandbox.runWithPrompt({ systemPrompt: 'Temporary prompt', prompt: 'third' }),
    ).resolves.toBe('history:0');
  });

  it('applies disabled tools control to sub-agent', async () => {
    const agentEngine = {
      createAgent: vi.fn().mockReturnValue({ state: {} }),
      process: vi.fn().mockResolvedValue({ content: 'delegated answer' }),
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

    expect(agentEngine.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'researcher',
        toolPermission: { mode: 'allowlist', list: [] },
      }),
      expect.any(String),
      expect.any(Object),
    );
    expect(agentEngine.process).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ components: [{ type: 'Plain', text: 'bounded' }] }),
      expect.any(Object),
      expect.objectContaining({ toolPermission: { mode: 'allowlist', list: [] } }),
      undefined,
    );
  });
});
