import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionEngine } from './ExecutionEngine.js';
import type { ExecutionPolicy } from './ExecutionTypes.js';

function createEngine() {
  const toolRegistry = {
    getDefinitions: () => [],
    execute: async () => ''
  };

  const role = {
    name: 'worker',
    provider: 'mock',
    model: 'mock-model',
    systemPrompt: 'role system prompt',
    builtin: false,
    availableSkills: ['demo-skill'],
    availableTools: [],
    missingSkills: [],
    missingTools: []
  };

  const agentRoleService = {
    getResolvedRole: (name?: string | null) => ({ ...role, name: name || role.name }),
    getDefaultRoleName: () => 'main',
    getAllowedToolNames: () => [],
    getVisionSettingsForRole: () => undefined,
    buildSkillsPrompt: (name?: string | null) => `skills:${name || role.name}`,
    buildRoleDescriptionsPrompt: () => '',
    createProviderForRole: () => ({ call: async () => ({ content: '', toolCalls: [], finishReason: 'stop' }) }),
    createVisionProviderForRole: () => undefined
  };

  const engine = new ExecutionEngine({
    defaultProvider: { call: async () => ({ content: '', toolCalls: [], finishReason: 'stop' }) } as any,
    mainModel: 'mock-model',
    defaultSystemPrompt: 'main system prompt',
    maxIterations: 4,
    memoryWindow: 20,
    toolRegistry: toolRegistry as any,
    workspace: '',
    getPluginManager: () => undefined,
    executionRegistry: { begin: () => new AbortController() } as any
  }, agentRoleService as any);

  const capturedPolicies: ExecutionPolicy[] = [];
  (engine as any).executeSubAgentTask = async (policy: ExecutionPolicy) => {
    capturedPolicies.push(policy);
    return policy.skillsPrompt;
  };

  return { engine, capturedPolicies };
}

test('runSubAgentTask keeps role skills prompt', async () => {
  const { engine, capturedPolicies } = createEngine();

  const result = await engine.runSubAgentTask('worker', 'do work', {} as any);

  assert.equal(result, 'skills:worker');
  assert.equal(capturedPolicies.length, 1);
  assert.equal(capturedPolicies[0]?.skillsPrompt, 'skills:worker');
  assert.equal(capturedPolicies[0]?.systemPrompt, 'role system prompt');
});

test('runTemporarySubAgentTask keeps parent role skills prompt and overrides system prompt', async () => {
  const { engine, capturedPolicies } = createEngine();

  const result = await engine.runTemporarySubAgentTask('planner', 'do temp work', 'temporary system prompt', {} as any);

  assert.equal(result, 'skills:planner');
  assert.equal(capturedPolicies.length, 1);
  assert.equal(capturedPolicies[0]?.roleName, 'planner');
  assert.equal(capturedPolicies[0]?.skillsPrompt, 'skills:planner');
  assert.equal(capturedPolicies[0]?.systemPrompt, 'temporary system prompt');
});
