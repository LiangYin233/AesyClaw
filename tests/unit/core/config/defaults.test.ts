import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults';

describe('DEFAULT_CONFIG', () => {
  it('has no core server config section', () => {
    expect(DEFAULT_CONFIG).not.toHaveProperty('server');
  });

  it('has empty providers and channels', () => {
    expect(DEFAULT_CONFIG.providers).toEqual({});
    expect(DEFAULT_CONFIG.channels).toEqual({});
  });

  it('has agent runtime settings', () => {
    expect(DEFAULT_CONFIG.agent.defaultModel).toBeTruthy();
    expect(DEFAULT_CONFIG.agent.logLevel).toBeTruthy();
    expect(DEFAULT_CONFIG.agent.memory.compressionThreshold).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.agent.memory.compressionThreshold).toBeLessThanOrEqual(1);
  });

  it('has empty plugins record', () => {
    expect(DEFAULT_CONFIG.plugins).toEqual({});
  });

  it('has disabled example MCP server', () => {
    expect(Array.isArray(DEFAULT_CONFIG.mcp)).toBe(true);
    const example = DEFAULT_CONFIG.mcp[0];
    expect(example?.name).toBe('example');
    expect(example?.enabled).toBe(false);
  });
});
