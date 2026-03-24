import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from './index.js';
import { tokenUsage } from '../observability/index.js';

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('createDefaultConfig leaves providers and main role model unconfigured', async () => {
  try {
    const config = createDefaultConfig();

    assert.deepEqual(config.providers, {});
    assert.equal(config.agents.roles.main.model, '');
  } finally {
    await cleanupTokenUsage();
  }
});
