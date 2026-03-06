import { describe, it, expect } from 'vitest';
import { ConfigLoader } from '../../src/config/loader';
import type { Config } from '../../src/types';

function makeValidConfig(overrides?: Partial<Config>): Config {
  return {
    server: { host: '0.0.0.0', port: 18791, apiPort: 18792 },
    agent: {
      defaults: {
        model: 'gpt-4o',
        provider: 'openai',
        maxToolIterations: 40,
        memoryWindow: 50,
        systemPrompt: 'test',
        contextMode: 'channel',
        maxSessions: 100
      }
    },
    channels: {},
    providers: {
      openai: { apiKey: 'sk-test', apiBase: 'https://api.openai.com/v1' }
    },
    ...overrides
  } as Config;
}

describe('ConfigLoader.validate', () => {
  it('should pass for valid config', () => {
    const result = ConfigLoader.validate(makeValidConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should error when agent.defaults.provider is missing', () => {
    const config = makeValidConfig();
    (config.agent.defaults as any).provider = '';
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('agent.defaults.provider is required');
  });

  it('should error when agent.defaults.model is missing', () => {
    const config = makeValidConfig();
    (config.agent.defaults as any).model = '';
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('agent.defaults.model is required');
  });

  it('should error when provider is not in providers section', () => {
    const config = makeValidConfig();
    config.agent.defaults.provider = 'anthropic';
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('anthropic'))).toBe(true);
  });

  it('should warn when provider has no apiKey', () => {
    const config = makeValidConfig();
    config.providers.openai.apiKey = '';
    const result = ConfigLoader.validate(config);
    // May still be valid, just a warning
    expect(result.warnings.some(w => w.includes('apiKey'))).toBe(true);
  });

  it('should error for invalid server.port (negative)', () => {
    const config = makeValidConfig();
    config.server.port = -1;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('server.port'))).toBe(true);
  });

  it('should error for port > 65535', () => {
    const config = makeValidConfig();
    config.server.port = 70000;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
  });

  it('should error for invalid apiPort', () => {
    const config = makeValidConfig();
    config.server.apiPort = -1;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('apiPort'))).toBe(true);
  });

  it('should error for invalid contextMode', () => {
    const config = makeValidConfig();
    (config.agent.defaults as any).contextMode = 'invalid';
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('contextMode'))).toBe(true);
  });

  it('should error for negative maxToolIterations', () => {
    const config = makeValidConfig();
    config.agent.defaults.maxToolIterations = -1;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maxToolIterations'))).toBe(true);
  });

  it('should warn for maxToolIterations > 100', () => {
    const config = makeValidConfig();
    config.agent.defaults.maxToolIterations = 150;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('maxToolIterations'))).toBe(true);
  });

  it('should error for negative memoryWindow', () => {
    const config = makeValidConfig();
    config.agent.defaults.memoryWindow = -5;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('memoryWindow'))).toBe(true);
  });

  it('should error for maxSessions < 1', () => {
    const config = makeValidConfig();
    config.agent.defaults.maxSessions = 0;
    const result = ConfigLoader.validate(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maxSessions'))).toBe(true);
  });

  it('should warn when onebot channel is enabled without wsUrl', () => {
    const config = makeValidConfig({
      channels: {
        onebot: { enabled: true }
      }
    });
    const result = ConfigLoader.validate(config);
    expect(result.warnings.some(w => w.includes('wsUrl'))).toBe(true);
  });

  it('should not warn for disabled channels', () => {
    const config = makeValidConfig({
      channels: {
        onebot: { enabled: false }
      }
    });
    const result = ConfigLoader.validate(config);
    expect(result.warnings.filter(w => w.includes('wsUrl'))).toHaveLength(0);
  });
});
