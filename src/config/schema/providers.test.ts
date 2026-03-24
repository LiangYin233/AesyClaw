import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig } from './index.js';

test('provider schema preserves per-model maxContextTokens config', () => {
  const config = parseConfig({
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

  assert.equal(config.providers.custom.models?.['minimax-m2.7']?.maxContextTokens, 100000);
});
