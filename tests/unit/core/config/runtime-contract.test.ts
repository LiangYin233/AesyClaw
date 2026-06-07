import { describe, expect, it } from 'vitest';
import { AppConfigSchema } from '../../../../src/core/config/schema';

// 通过 AppConfigSchema 访问嵌套 schema，避免单独导出未在外部使用的模式
const AgentConfigSchema = AppConfigSchema.properties.agent;
const MemoryConfigSchema = AgentConfigSchema.properties.memory;

const runtimeConsumedConfigKeys: Record<string, string[]> = {
  agent: ['defaultModel', 'logLevel', 'memory'],
  memory: ['compressionThreshold'],
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
