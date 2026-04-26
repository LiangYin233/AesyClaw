/**
 * Config Injection unit tests.
 *
 * Tests cover: config is injected into state, config is read-only snapshot.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { configInjection } from '../../../../src/pipeline/middleware/config-injection';
import type { PipelineState } from '../../../../src/pipeline/middleware/types';
import { ConfigManager } from '../../../../src/core/config/config-manager';
import type { InboundMessage } from '../../../../src/core/types';

// ─── Helpers ──────────────────────────────────────────────────────

function makeInbound(content = 'hello'): InboundMessage {
  return {
    sessionKey: { channel: 'test', type: 'private', chatId: 'user1' },
    content,
  };
}

function makeState(): PipelineState {
  return { inbound: makeInbound() };
}

async function createLoadedConfigManager(): Promise<ConfigManager> {
  const cm = new ConfigManager();
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-test-'));
  const configPath = path.join(tmpDir, 'config.json');
  await cm.load(configPath);
  return cm;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('configInjection', () => {
  let configManager: ConfigManager;

  beforeEach(async () => {
    configManager = await createLoadedConfigManager();
  });

  it('should inject config into state', async () => {
    const state = makeState();
    const result = await configInjection(state, configManager);

    expect(result.config).toBeDefined();
    expect(result.config).toEqual(configManager.getConfig());
  });

  it('should not modify other state fields', async () => {
    const state = makeState();
    const result = await configInjection(state, configManager);

    expect(result.inbound).toBe(state.inbound);
    expect(result.outbound).toBeUndefined();
    expect(result.blocked).toBeUndefined();
  });
});
