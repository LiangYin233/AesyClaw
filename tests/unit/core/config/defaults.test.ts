import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../../src/core/config/defaults';

describe('DEFAULT_CONFIG', () => {
  it('has server defaults', () => {
    expect(DEFAULT_CONFIG.server.port).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.server.host).toBeTruthy();
    expect(DEFAULT_CONFIG.server.logLevel).toBeTruthy();
  });

  it('has empty providers and channels', () => {
    expect(DEFAULT_CONFIG.providers).toEqual({});
    expect(DEFAULT_CONFIG.channels).toEqual({});
  });

  it('has agent memory settings', () => {
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
