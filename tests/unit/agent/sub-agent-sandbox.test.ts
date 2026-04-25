import { describe, expect, it, vi } from 'vitest';
import { createPersistedAssistantMessage, createUserMessage } from '../../../src/agent/agent-types';
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

describe('SubAgentSandbox', () => {
  it('uses isolated in-memory history for each delegated run', async () => {
    const agentEngine = {
      createAgent: vi.fn().mockReturnValue({ state: {} }),
      process: vi.fn().mockImplementation(async (_agent, message, memory) => {
        const historyBefore = await memory.loadHistory();
        await memory.syncFromAgent([
          createUserMessage(message.content),
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
});
