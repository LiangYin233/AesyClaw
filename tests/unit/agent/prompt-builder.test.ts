import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../../src/agent/agent';
import type { RoleConfig, Skill } from '../../../src/core/types';
import { SkillManager } from '../../../src/skill/skill-manager';
import type { AesyClawTool } from '../../../src/tool/tool-registry';
import type { AgentTool } from '../../../src/agent/agent-types';
import { Type } from '@sinclair/typebox';

function makeRole(overrides: Partial<RoleConfig> = {}): RoleConfig {
  return {
    id: 'assistant',
    name: 'Assistant',
    description: 'A helpful assistant',
    systemPrompt: 'You are {{role}}.',
    model: 'openai/gpt-4o',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills: ['greeting'],
    enabled: true,
    ...overrides,
  };
}

function makeTool(overrides: Partial<AesyClawTool> = {}): AesyClawTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: Type.Object({ input: Type.String() }),
    owner: 'system',
    execute: async () => ({ content: 'ok' }),
    ...overrides,
  };
}

function makeAgentTool(overrides: Partial<AgentTool> = {}): AgentTool {
  return {
    name: 'test-tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ text: 'ok' }),
    ...overrides,
  };
}

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'greeting',
    description: 'Greeting skill',
    content: 'Say hello.',
    isSystem: false,
    filePath: '/skills/greeting.md',
    ...overrides,
  };
}

describe('PromptBuilder', () => {
  afterEach(() => {
    Agent.activeAgents.clear();
  });

  function makeDeps(overrides: Record<string, unknown> = {}) {
    const roleManager = {
      getEnabledRoles: vi.fn().mockReturnValue([makeRole()]),
      ...(overrides.roleManager ?? {}),
    };
    const skillManager = {
      getSkillsForRole: vi.fn().mockReturnValue([makeSkill()]),
      ...(overrides.skillManager ?? {}),
    };
    const toolRegistry = {
      resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
      ...(overrides.toolRegistry ?? {}),
    };
    const toolHookDispatcher = {
      dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
      dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
      ...(overrides.toolHookDispatcher ?? {}),
    };

    return {
      roleManager,
      skillManager,
      toolRegistry,
      toolHookDispatcher,
    };
  }

  function makeAgent(deps: ReturnType<typeof makeDeps>): Agent {
    return new Agent({
      session: {
        key: { channel: 'test', type: 'private', chatId: 'prompt-builder' },
      } as never,
      llmAdapter: { resolveModel: vi.fn() } as never,
      roleManager: deps.roleManager as never,
      skillManager: deps.skillManager as never,
      toolRegistry: deps.toolRegistry as never,
      hookDispatcher: deps.toolHookDispatcher as never,
    });
  }

  describe('buildPrompt', () => {
    it('should build a prompt with role, tools, and skills', () => {
      const deps = makeDeps();
      const agent = makeAgent(deps);

      const role = makeRole();

      const result = agent.buildPrompt(role);

      expect(result.prompt).toContain('You are {{role}}.');
      expect(result.prompt).toContain('## Skill: greeting');
      expect(result.prompt).toContain('## Available Roles');
      expect(result.tools).toEqual([]);
      expect(deps.skillManager.getSkillsForRole).toHaveBeenCalledWith(role);
      expect(deps.roleManager.getEnabledRoles).toHaveBeenCalled();
    });

    it('should return resolved AgentTools', () => {
      const agentTool = makeAgentTool({ name: 'custom-tool' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [agentTool] }),
        },
      });
      const agent = makeAgent(deps);

      const role = makeRole();

      const result = agent.buildPrompt(role);

      expect(result.tools).toEqual([agentTool]);
      expect(result.tools).toHaveLength(1);
    });

    it('should omit skill sections when no skills are available', () => {
      const deps = makeDeps({
        skillManager: {
          getSkillsForRole: vi.fn().mockReturnValue([]),
        },
      });
      const agent = makeAgent(deps);

      const result = agent.buildPrompt(makeRole({ skills: [] }));

      expect(result.prompt).not.toContain('## Skill:');
    });

    it('should format multiple skill sections directly in the agent prompt', () => {
      const deps = makeDeps({
        skillManager: {
          getSkillsForRole: vi.fn().mockReturnValue([
            makeSkill({ name: 'first', content: 'First content.' }),
            makeSkill({ name: 'second', content: 'Second content.' }),
          ]),
        },
      });
      const agent = makeAgent(deps);

      const result = agent.buildPrompt(makeRole({ skills: ['first', 'second'] }));

      expect(result.prompt).toContain(
        '## Skill: first\nFirst content.\n\n## Skill: second\nSecond content.',
      );
    });

    it('should include filtered internal tools in final prompt content', () => {
      const internalTool = makeTool({ name: 'send-msg' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [internalTool], agentTools: [] }),
        },
      });
      const agent = makeAgent(deps);

      const role = makeRole();

      const result = agent.buildPrompt(role);

      expect(result.prompt).toContain('## Available Tools');
      expect(result.prompt).toContain('**send-msg**: A test tool');
    });

    it('should filter tools by role permissions', () => {
      const allowedTool = makeTool({ name: 'allowed' });

      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [allowedTool], agentTools: [] }),
        },
      });
      const agent = makeAgent(deps);
      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['allowed'] },
      });

      const result = agent.buildPrompt(role);

      expect(result.prompt).toContain('**allowed**: A test tool');
    });

    it('should pass all enabled roles into the prompt', () => {
      const roles = [makeRole({ id: 'admin' }), makeRole({ id: 'user' })];
      const deps = makeDeps({
        roleManager: {
          getEnabledRoles: vi.fn().mockReturnValue(roles),
        },
      });
      const agent = makeAgent(deps);

      const result = agent.buildPrompt(makeRole());

      expect(result.prompt).toContain('**admin** — A helpful assistant');
      expect(result.prompt).toContain('**user** — A helpful assistant');
    });

    it('should pass execution context to tool resolution', () => {
      const deps = makeDeps();
      const agent = makeAgent(deps);
      const ctx = { sessionKey: { channel: 'test', type: 'private', chatId: '1' } };

      agent.buildPrompt(makeRole(), ctx);

      expect(deps.toolRegistry.resolveForRole).toHaveBeenCalledWith(
        expect.any(Object),
        deps.toolHookDispatcher,
        { sessionKey: expect.any(Object) },
      );
    });

    it('should inject only system skills plus role-allowed user skills into the prompt path', async () => {
      const skillManager = new SkillManager();
      const skillRoot = join(tmpdir(), `aesyclaw-prompt-builder-${Date.now()}`);
      const systemDir = join(skillRoot, 'system');
      const userDir = join(skillRoot, 'user');

      mkdirSync(systemDir, { recursive: true });
      mkdirSync(userDir, { recursive: true });

      writeFileSync(
        join(systemDir, 'system-skill.md'),
        `---
name: system-skill
description: System
---
System content.`,
      );
      writeFileSync(
        join(userDir, 'allowed-skill.md'),
        `---
name: allowed-skill
description: Allowed
---
Allowed content.`,
      );
      writeFileSync(
        join(userDir, 'blocked-skill.md'),
        `---
name: blocked-skill
description: Blocked
---
Blocked content.`,
      );

      await skillManager.loadAll(userDir, systemDir);

      const roleManager = {
        getEnabledRoles: vi.fn().mockReturnValue([makeRole()]),
      };
      const agent = new Agent({
        session: {
          key: { channel: 'test', type: 'private', chatId: 'prompt-builder-skills' },
        } as never,
        llmAdapter: { resolveModel: vi.fn() } as never,
        roleManager: roleManager as never,
        skillManager,
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
        } as never,
        hookDispatcher: {
          dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
          dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
        } as never,
      });

      try {
        const result = agent.buildPrompt(makeRole({ skills: ['allowed-skill'] }));

        expect(result.prompt).toContain('## Skill: system-skill');
        expect(result.prompt).toContain('System content.');
        expect(result.prompt).toContain('## Skill: allowed-skill');
        expect(result.prompt).toContain('Allowed content.');
        expect(result.prompt).not.toContain('blocked-skill');
      } finally {
        rmSync(skillRoot, { recursive: true, force: true });
      }
    });
  });
});
