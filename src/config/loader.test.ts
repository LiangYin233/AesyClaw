import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tokenUsage } from '../observability/index.js';
import { ConfigLoader, createDefaultConfig } from './loader.js';

function resetConfigLoader(configPath: string) {
  ConfigLoader.stopWatching();
  ConfigLoader.setPath(configPath);
  (ConfigLoader as any).config = null;
  (ConfigLoader as any).lastAppliedSignature = null;
  (ConfigLoader as any).reloadListeners = new Set();
}

async function cleanupTokenUsage() {
  clearInterval((tokenUsage as any).saveInterval);
  await (tokenUsage as any).closeDatabase?.();
}

test('ConfigLoader.update accepts normalized in-memory config objects', async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'aesyclaw-loader-'));
  const configPath = join(tempRoot, 'config.toml');

  try {
    resetConfigLoader(configPath);
    await ConfigLoader.load(configPath);

    await assert.doesNotReject(async () => {
      await ConfigLoader.update((config) => config);
    });

    const savedConfig = ConfigLoader.get();
    assert.deepEqual(savedConfig.providers, createDefaultConfig().providers);
  } finally {
    ConfigLoader.stopWatching();
    await cleanupTokenUsage();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
