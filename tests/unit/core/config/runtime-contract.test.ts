import { describe, expect, it } from 'vitest';
import { AgentConfigSchema, MemoryConfigSchema, type AppConfig } from '../../../../src/core/config/schema';

const runtimeConsumedConfigKeys = {
  agent: ['maxSteps'],
  memory: ['compressionThreshold', 'maxContextTokens'],
} satisfies {
  agent: Array<keyof AppConfig['agent'] & string>;
  memory: Array<keyof AppConfig['memory'] & string>;
};

describe('runtime config consumption contract', () => {
  it('keeps every agent config schema field covered by runtime behavior', () => {
    expect(schemaKeys(AgentConfigSchema)).toEqual(runtimeConsumedConfigKeys.agent.sort());
  });

  it('keeps every memory config schema field covered by runtime behavior', () => {
    expect(schemaKeys(MemoryConfigSchema)).toEqual(runtimeConsumedConfigKeys.memory.sort());
  });
});

function schemaKeys(schema: { properties: Record<string, unknown> }): string[] {
  return Object.keys(schema.properties).sort();
}
