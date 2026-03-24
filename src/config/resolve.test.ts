import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProviderSelection } from './resolve.js';
import { tokenUsage } from '../observability/index.js';

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('resolveProviderSelection keeps empty refs empty instead of defaulting provider', async () => {
  try {
    const selection = resolveProviderSelection({ providers: {} }, '');

    assert.equal(selection.name, '');
    assert.equal(selection.model, '');
    assert.equal(selection.providerConfig, undefined);
  } finally {
    await cleanupTokenUsage();
  }
});
