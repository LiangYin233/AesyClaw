import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeCoordinator } from './RuntimeCoordinator.js';
import { tokenUsage } from '../../../observability/index.js';

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('RuntimeCoordinator can be created without a main model when role service is present', async () => {
  try {
    assert.doesNotThrow(() => new RuntimeCoordinator({
      provider: undefined as any,
      toolRegistry: { getDefinitions: () => [], execute: async () => '' } as any,
      sessionManager: {} as any,
      commandRegistry: {} as any,
      sessionRouting: {} as any,
      outboundGateway: {} as any,
      workspace: '',
      model: '',
      agentRoleService: {} as any,
      getPluginManager: () => undefined
    }));
  } finally {
    await cleanupTokenUsage();
  }
});
