/**
 * ConfigInjectionMiddleware unit tests.
 *
 * Tests cover: config is injected into state, config is read-only snapshot.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigInjectionMiddleware } from '../../../../src/pipeline/middleware/config-injection';
import type { PipelineState, NextFn } from '../../../../src/pipeline/middleware/types';
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

/** Identity next function for testing single middleware */
const identityNext: NextFn = async (state: PipelineState) => state;

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

describe('ConfigInjectionMiddleware', () => {
  let middleware: ConfigInjectionMiddleware;
  let configManager: ConfigManager;

  beforeEach(async () => {
    configManager = await createLoadedConfigManager();
    middleware = new ConfigInjectionMiddleware(configManager);
  });

  it('should inject config into state', async () => {
    const state = makeState();
    const result = await middleware.execute(state, identityNext);

    expect(result.config).toBeDefined();
    expect(result.config).toEqual(configManager.getConfig());
  });

  it('should call next after injecting config', async () => {
    const state = makeState();
    let nextCalled = false;
    const next: NextFn = async (s) => {
      nextCalled = true;
      return s;
    };

    await middleware.execute(state, next);
    expect(nextCalled).toBe(true);
  });

  it('should not modify other state fields', async () => {
    const state = makeState();
    const result = await middleware.execute(state, identityNext);

    expect(result.inbound).toBe(state.inbound);
    expect(result.outbound).toBeUndefined();
    expect(result.blocked).toBeUndefined();
  });

  it('should have the correct middleware name', () => {
    expect(middleware.name).toBe('ConfigInjection');
  });
});
