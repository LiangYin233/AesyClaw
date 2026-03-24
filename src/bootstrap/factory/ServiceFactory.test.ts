import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../../config/index.js';
import { tokenUsage } from '../../observability/index.js';
import * as serviceFactoryModule from './ServiceFactory.js';

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('bootstrapRuntimeConfig accepts normalized config objects', async () => {
  const bootstrapRuntimeConfig = (serviceFactoryModule as {
    bootstrapRuntimeConfig?: (config: ReturnType<typeof createDefaultConfig>) => ReturnType<typeof createDefaultConfig>;
  }).bootstrapRuntimeConfig;

  try {
    assert.equal(typeof bootstrapRuntimeConfig, 'function');
    assert.doesNotThrow(() => bootstrapRuntimeConfig!(createDefaultConfig()));
  } finally {
    await cleanupTokenUsage();
  }
});
