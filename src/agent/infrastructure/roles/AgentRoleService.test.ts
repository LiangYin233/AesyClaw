import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRoleService } from './AgentRoleService.js';
import { parseConfig } from '../../../config/index.js';
import { tokenUsage } from '../../../observability/index.js';

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('createProviderForRole reports unconfigured main model explicitly', async () => {
  try {
    const config = parseConfig({
      providers: {},
      agents: {
        roles: {
          main: {
            name: 'main',
            description: '内建主 Agent',
            systemPrompt: 'system',
            model: '',
            allowedSkills: [],
            allowedTools: []
          }
        }
      }
    });
    const service = new AgentRoleService(
      () => config,
      () => {},
      async () => config,
      { getDefinitions: () => [] } as any
    );

    assert.throws(() => service.createProviderForRole('main'), {
      message: 'Agent role model is not configured: main'
    });
  } finally {
    await cleanupTokenUsage();
  }
});
