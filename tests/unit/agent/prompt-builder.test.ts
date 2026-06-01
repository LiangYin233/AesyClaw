import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../../../src/agent/agent';
import { buildAgentPrompt } from '../../../src/agent/prompt/template';
import { buildRoleSection, buildSkillSection } from '../../../src/agent/prompt/sections';
import { AgentRegistry } from '../../../src/agent/registry';
import { HooksBus } from '../../../src/hook/hooks-bus';
import { createSkillPromptHook } from '../../../src/hook/builtin/skill-prompt';
import { createRolePromptHook } from '../../../src/hook/builtin/role-prompt';
import type { Skill } from '../../../src/core/types';
import { SkillManager } from '../../../src/skill/manager';
import type { AesyClawTool } from '../../../src/tool/tool-registry';
import type { AgentTool } from '../../../src/agent/types';
import { makeRole } from '../../helpers/role';
import { Type } from '@sinclair/typebox';

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
    label: 'Test Tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
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
  let agentRegistry: AgentRegistry;

  afterEach(() => {
    agentRegistry = new AgentRegistry();
  });

  beforeEach(() => {
    agentRegistry = new AgentRegistry();
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
    const hooksBus = {
      dispatch: vi.fn(
        async (
          chain: string,
          ctx: {
            role?: unknown;
            promptSections?: string[];
            isSubAgent?: boolean;
            isCron?: boolean;
          },
        ) => {
          if (chain === 'prompt:build' && ctx.role !== undefined) {
            if (ctx.promptSections !== undefined) {
              const skills = skillManager.getSkillsForRole(ctx.role as never);
              if (skills.length > 0) {
                ctx.promptSections.push(buildSkillSection(skills));
              }
            }

            if (ctx.promptSections !== undefined && ctx.isSubAgent !== true) {
              if (ctx.isCron !== true) {
                ctx.promptSections.push('## 用户沟通');
              }
              const roles = roleManager.getEnabledRoles();
              if (roles.length > 0) {
                ctx.promptSections.push(buildRoleSection(roles));
              }
            }
          }
          return { action: 'next' as const };
        },
      ),
      dispatchBeforeToolCall: vi.fn().mockResolvedValue({}),
      dispatchAfterToolCall: vi.fn().mockResolvedValue({}),
      ...(overrides.hooksBus ?? {}),
    };

    return {
      roleManager,
      skillManager,
      toolRegistry,
      hooksBus,
    };
  }

  function makeAgent(deps: ReturnType<typeof makeDeps>, registry: AgentRegistry): Agent {
    return new Agent({
      session: {
        key: { channel: 'test', type: 'private', chatId: 'prompt-builder' },
      } as never,
      llmAdapter: { resolveModel: vi.fn() } as never,
      toolRegistry: deps.toolRegistry as never,
      hooksBus: deps.hooksBus as never,
      compressionThreshold: 0.8,
      registry,
    });
  }

  describe('buildAgentPrompt', () => {
    it('should replace template variables and include prompt sections', () => {
      const prompt = buildAgentPrompt({
        role: makeRole({ systemPrompt: 'Today is {{os}} using {{systemLang}}.' }),
        promptSections: [
          '## 技能\n- **greeting**: Greeting skill',
          '## 用户沟通',
          '## 角色\n- **helper** — A helpful assistant',
        ],
      });

      expect(prompt).not.toContain('{{os}}');
      expect(prompt).not.toContain('{{systemLang}}');
      expect(prompt).not.toContain('## Available Tools');
      expect(prompt).toContain('**greeting**: Greeting skill');
      expect(prompt).toContain('## 用户沟通');
      expect(prompt).toContain('**helper** — A helpful assistant');
    });

    it('should omit communication and role sections for sub agents', () => {
      const prompt = buildAgentPrompt({
        role: makeRole(),
        promptSections: [],
      });

      expect(prompt).not.toContain('## 用户沟通');
      expect(prompt).not.toContain('## 角色');
    });

    it('should render caller-provided role sections', () => {
      const prompt = buildAgentPrompt({
        role: makeRole(),
        promptSections: ['## 角色\n- **helper** — A helpful assistant'],
      });

      expect(prompt).not.toContain('## 用户沟通');
      expect(prompt).toContain('## 角色');
    });
  });

  describe('buildPrompt', () => {
    it('should build a prompt with role, tools, and skills', async () => {
      const deps = makeDeps();
      const agent = makeAgent(deps, agentRegistry);

      const role = makeRole();

      const result = await agent.buildPrompt(role);

      expect(result.prompt).toContain('You are {{role}}.');
      expect(result.prompt).toContain('**greeting**: Greeting skill');
      expect(result.prompt).toContain('## 角色');
      expect(result.tools).toEqual([]);
      expect(deps.skillManager.getSkillsForRole).toHaveBeenCalledWith(role);
      expect(deps.roleManager.getEnabledRoles).toHaveBeenCalled();
    });

    it('should return resolved AgentTools', async () => {
      const agentTool = makeAgentTool({ name: 'custom-tool' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [agentTool] }),
        },
      });
      const agent = makeAgent(deps, agentRegistry);

      const role = makeRole();

      const result = await agent.buildPrompt(role);

      expect(result.tools).toEqual([agentTool]);
      expect(result.tools).toHaveLength(1);
    });

    it('should omit skill sections when no skills are available', async () => {
      const deps = makeDeps({
        skillManager: {
          getSkillsForRole: vi.fn().mockReturnValue([]),
        },
      });
      const agent = makeAgent(deps, agentRegistry);

      const result = await agent.buildPrompt(makeRole({ skills: [] }));

      expect(result.prompt).not.toContain('## 技能');
    });

    it('should format multiple skill sections directly in the agent prompt', async () => {
      const deps = makeDeps({
        skillManager: {
          getSkillsForRole: vi
            .fn()
            .mockReturnValue([
              makeSkill({ name: 'first', content: 'First content.' }),
              makeSkill({ name: 'second', content: 'Second content.' }),
            ]),
        },
      });
      const agent = makeAgent(deps, agentRegistry);

      const result = await agent.buildPrompt(makeRole({ skills: ['first', 'second'] }));

      expect(result.prompt).toContain('**first**: Greeting skill');
      expect(result.prompt).toContain('**second**: Greeting skill');
      expect(result.prompt).not.toContain('First content.');
      expect(result.prompt).not.toContain('Second content.');
    });

    it('should leave API tools out of final prompt content', async () => {
      const internalTool = makeTool({ name: 'send-msg' });
      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [internalTool], agentTools: [] }),
        },
      });
      const agent = makeAgent(deps, agentRegistry);

      const role = makeRole();

      const result = await agent.buildPrompt(role);

      expect(result.prompt).not.toContain('## Available Tools');
      expect(result.prompt).not.toContain('**send-msg**: A test tool');
    });

    it('should pass role permissions to tool resolution without duplicating tools in prompt', async () => {
      const allowedTool = makeTool({ name: 'allowed' });

      const deps = makeDeps({
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [allowedTool], agentTools: [] }),
        },
      });
      const agent = makeAgent(deps, agentRegistry);
      const role = makeRole({
        toolPermission: { mode: 'allowlist', list: ['allowed'] },
      });

      const result = await agent.buildPrompt(role);

      expect(deps.toolRegistry.resolveForRole).toHaveBeenCalledWith(role, deps.hooksBus, {});
      expect(result.prompt).not.toContain('**allowed**: A test tool');
    });

    it('should pass all enabled roles into the prompt', async () => {
      const roles = [makeRole({ id: 'admin' }), makeRole({ id: 'user' })];
      const deps = makeDeps({
        roleManager: {
          getEnabledRoles: vi.fn().mockReturnValue(roles),
        },
      });
      const agent = makeAgent(deps, agentRegistry);

      const result = await agent.buildPrompt(makeRole());

      expect(result.prompt).toContain('**admin** — A helpful assistant');
      expect(result.prompt).toContain('**user** — A helpful assistant');
    });

    it('should pass execution context to tool resolution', async () => {
      const deps = makeDeps();
      const agent = makeAgent(deps, agentRegistry);
      const ctx = { sessionKey: { channel: 'test', type: 'private', chatId: '1' } };

      await agent.buildPrompt(makeRole(), ctx);

      expect(deps.toolRegistry.resolveForRole).toHaveBeenCalledWith(
        expect.any(Object),
        deps.hooksBus,
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

      mkdirSync(join(systemDir, 'system-skill'), { recursive: true });
      mkdirSync(join(userDir, 'allowed-skill'), { recursive: true });
      mkdirSync(join(userDir, 'blocked-skill'), { recursive: true });

      writeFileSync(
        join(systemDir, 'system-skill', 'SKILL.md'),
        `---
name: system-skill
description: System
---
System content.`,
      );
      writeFileSync(
        join(userDir, 'allowed-skill', 'SKILL.md'),
        `---
name: allowed-skill
description: Allowed
---
Allowed content.`,
      );
      writeFileSync(
        join(userDir, 'blocked-skill', 'SKILL.md'),
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
      const registry = new AgentRegistry();
      const hooksBus = new HooksBus();
      hooksBus.register(createSkillPromptHook(skillManager));
      hooksBus.register(createRolePromptHook(roleManager));
      const agent = new Agent({
        session: {
          key: { channel: 'test', type: 'private', chatId: 'prompt-builder-skills' },
        } as never,
        llmAdapter: { resolveModel: vi.fn() } as never,
        toolRegistry: {
          resolveForRole: vi.fn().mockReturnValue({ tools: [], agentTools: [] }),
        } as never,
        hooksBus,
        compressionThreshold: 0.8,
        registry,
      });

      try {
        const result = await agent.buildPrompt(makeRole({ skills: ['allowed-skill'] }));

        expect(result.prompt).toContain('**system-skill**: System');
        expect(result.prompt).toContain('**allowed-skill**: Allowed');
        expect(result.prompt).not.toContain('blocked-skill');
      } finally {
        rmSync(skillRoot, { recursive: true, force: true });
      }
    });
  });
});
