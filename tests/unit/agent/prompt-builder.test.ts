import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PromptBuilder, type PromptBuilderDependencies } from '../../../src/agent/prompt-builder';
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
  function makeDeps(overrides: Partial<PromptBuilderDependencies> = {}): PromptBuilderDependencies {
    const roleManager = {
      getEnabledRoles: vi.fn().mockReturnValue([makeRole()]),
      buildSystemPrompt: vi.fn().mockReturnValue('Built prompt: You are Assistant.'),
      ...(overrides.roleManager ?? {}),
    };
    const skillManager = {
      getSkillsForRole: vi.fn().mockReturnValue([makeSkill()]),
      ...(overrides.skillManager ?? {}),
    };
    const toolRegistry = {
      resolveForRoleWithDefinitions: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
      resolveForRole: vi.fn().mockReturnValue([]),
      ...(overrides.toolRegistry ?? {}),
    };
    const hookDispatcher = {
      dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
      dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
      ...(overrides.hookDispatcher ?? {}),
    };

    return {
      roleManager,
      skillManager,
      toolRegistry,
      hookDispatcher,
    } as unknown as PromptBuilderDependencies;
  }

  describe('buildSystemPrompt', () => {
    it('should build a prompt with role, tools, and skills', () => {
      const deps = makeDeps();
      const builder = new PromptBuilder(deps);
      const role = makeRole();

      const result = builder.buildSystemPrompt(role);

      expect(result.prompt).toBe('Built prompt: You are Assistant.');
      expect(result.tools).toEqual([]);
      expect(deps.skillManager.getSkillsForRole).toHaveBeenCalledWith(role);
      expect(deps.roleManager.getEnabledRoles).toHaveBeenCalled();
      expect(deps.roleManager.buildSystemPrompt).toHaveBeenCalled();
    });

    it('should return resolved AgentTools', () => {
      const agentTool = makeAgentTool({ name: 'custom-tool' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRoleWithDefinitions: vi
            .fn()
            .mockReturnValue({ tools: [], agentTools: [agentTool] }),
          resolveForRole: vi.fn().mockReturnValue([]),
        },
      });
      const builder = new PromptBuilder(deps);
      const role = makeRole();

      const result = builder.buildSystemPrompt(role);

      expect(result.tools).toEqual([agentTool]);
      expect(result.tools).toHaveLength(1);
    });

    it('should pass filtered internal tools to roleManager.buildSystemPrompt', () => {
      const internalTool = makeTool({ name: 'send-msg' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRoleWithDefinitions: vi
            .fn()
            .mockReturnValue({ tools: [internalTool], agentTools: [] }),
          resolveForRole: vi.fn().mockReturnValue([]),
        },
      });
      const builder = new PromptBuilder(deps);
      const role = makeRole();

      builder.buildSystemPrompt(role);

      const buildCall = deps.roleManager.buildSystemPrompt.mock.calls[0] as [
        RoleConfig,
        AesyClawTool[],
        Skill[],
        RoleConfig[],
      ];
      const filteredTools = buildCall[1] as AesyClawTool[];
      expect(filteredTools).toHaveLength(1);
      expect(filteredTools[0].name).toBe('send-msg');
    });

    it('should filter tools by role permissions', () => {
      const allowedTool = makeTool({ name: 'allowed' });

      const deps = makeDeps({
        toolRegistry: {
          resolveForRoleWithDefinitions: vi
            .fn()
            .mockReturnValue({ tools: [allowedTool], agentTools: [] }),
          resolveForRole: vi.fn().mockReturnValue([]),
        },
      });
      const builder = new PromptBuilder(deps);
      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['allowed'] },
      });

      builder.buildSystemPrompt(role);

      const buildCall = deps.roleManager.buildSystemPrompt.mock.calls[0] as [
        RoleConfig,
        AesyClawTool[],
        Skill[],
        RoleConfig[],
      ];
      const filteredTools = buildCall[1] as AesyClawTool[];
      expect(filteredTools).toHaveLength(1);
      expect(filteredTools[0].name).toBe('allowed');
    });

    it('should pass all enabled roles to buildSystemPrompt', () => {
      const roles = [makeRole({ id: 'admin' }), makeRole({ id: 'user' })];
      const deps = makeDeps({
        roleManager: {
          getEnabledRoles: vi.fn().mockReturnValue(roles),
          buildSystemPrompt: vi.fn().mockReturnValue('prompt with roles'),
        },
      });
      const builder = new PromptBuilder(deps);

      builder.buildSystemPrompt(makeRole());

      const buildCall = deps.roleManager.buildSystemPrompt.mock.calls[0] as [
        RoleConfig,
        AesyClawTool[],
        Skill[],
        RoleConfig[],
      ];
      const allRoles = buildCall[3] as RoleConfig[];
      expect(allRoles).toEqual(roles);
    });

    it('should pass execution context to tool resolution', () => {
      const deps = makeDeps();
      const builder = new PromptBuilder(deps);
      const ctx = { sessionKey: { channel: 'test', type: 'private', chatId: '1' } };

      builder.buildSystemPrompt(makeRole(), ctx);

      expect(deps.toolRegistry.resolveForRoleWithDefinitions).toHaveBeenCalledWith(
        expect.any(Object),
        deps.hookDispatcher,
        ctx,
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

      await skillManager.loadAll(systemDir, userDir);

      const roleManager = {
        getEnabledRoles: vi.fn().mockReturnValue([makeRole()]),
        buildSystemPrompt: vi.fn().mockReturnValue('prompt'),
      };
      const builder = new PromptBuilder({
        roleManager: roleManager as unknown as PromptBuilderDependencies['roleManager'],
        skillManager,
        toolRegistry: {
          resolveForRoleWithDefinitions: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
          resolveForRole: vi.fn().mockReturnValue([]),
        } as unknown as PromptBuilderDependencies['toolRegistry'],
        hookDispatcher: {
          dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
          dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
        } as unknown as PromptBuilderDependencies['hookDispatcher'],
      });

      try {
        builder.buildSystemPrompt(makeRole({ skills: ['allowed-skill'] }));

        const buildCall = roleManager.buildSystemPrompt.mock.calls[0] as [
          RoleConfig,
          AesyClawTool[],
          Skill[],
          RoleConfig[],
        ];
        const injectedSkills = buildCall[2];

        expect(injectedSkills.map((skill) => skill.name)).toEqual([
          'system-skill',
          'allowed-skill',
        ]);
      } finally {
        rmSync(skillRoot, { recursive: true, force: true });
      }
    });
  });
});
