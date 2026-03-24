import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentRoleService } from './AgentRoleService.js';
import { parseConfig } from '../../../config/schema/index.js';

test('resolves maxContextTokens from the current role provider model config', () => {
  let currentConfig = parseConfig({
    providers: {
      custom: {
        type: 'openai',
        apiKey: 'test-key',
        models: {
          'minimax-m2.7': {
            maxContextTokens: 100000
          }
        }
      }
    },
    agents: {
      roles: {
        main: {
          name: 'main',
          provider: 'custom',
          model: 'minimax-m2.7',
          systemPrompt: 'test system prompt',
          allowedSkills: [],
          allowedTools: []
        }
      }
    }
  });

  const service = new AgentRoleService(
    () => currentConfig,
    (nextConfig) => {
      currentConfig = nextConfig;
    },
    async (mutator) => {
      const maybeNext = await mutator(currentConfig);
      if (maybeNext) {
        currentConfig = maybeNext;
      }
      return currentConfig;
    },
    {
      getDefinitions: () => []
    }
  );

  assert.equal(service.getMaxContextTokensForRole('main'), 100000);
});
