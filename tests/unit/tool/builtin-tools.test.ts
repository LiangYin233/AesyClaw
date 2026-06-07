import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { completeSimple } from '@earendil-works/pi-ai';
import type * as PiAiModule from '@earendil-works/pi-ai';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { createSendMsgTool } from '../../../src/tool/builtin/send-msg';
import { createLoadSkillTool } from '../../../src/tool/builtin/load-skill';
import {
  createRunSubAgentTool,
  createRunTempSubAgentTool,
} from '../../../src/tool/builtin/run-sub-agent';
import { registerBuiltinTools } from '../../../src/tool/builtin';
import type { RoleConfig, Skill } from '../../../src/core/types';

vi.mock('@earendil-works/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@earendil-works/pi-ai');
  return {
    ...actual,
    completeSimple: vi.fn(),
  };
});

const SESSION_KEY = { channel: 'test', type: 'private', chatId: 'user-1' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(completeSimple).mockReset();
});

function makeSkillManager(skills: Skill[] = []) {
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    getSkill: vi.fn((name: string) => skillMap.get(name)),
    getSkillsForRole: vi.fn((role?: RoleConfig) =>
      skills.filter((skill) => {
        if (skill.isSystem) return true;
        if (!role) return false;
        if (role.skills.length === 1 && role.skills[0] === '*') return true;
        const allowedSkills: readonly string[] = role.skills;
        return allowedSkills.includes(skill.name);
      }),
    ),
  };
}

function makeRole(skills: RoleConfig['skills'] = ['*']): RoleConfig {
  return {
    id: 'test-role',
    description: 'Test role',
    systemPrompt: 'Test',
    toolPermission: { mode: 'allowlist', list: ['*'] },
    skills,
    enabled: true,
  };
}

function makeToolContext(role: RoleConfig = makeRole()) {
  return { sessionKey: SESSION_KEY, role };
}

describe('built-in tools', () => {
  it('send_msg returns a truthful error when no send callback is available', async () => {
    const tool = createSendMsgTool();

    await expect(tool.execute({ text: 'hello' }, makeToolContext())).resolves.toEqual(
      expect.objectContaining({
        isError: true,
      }),
    );
  });

  it('send_msg uses the provided outbound send callback', async () => {
    const tool = createSendMsgTool();
    const sendMessage = vi.fn().mockResolvedValue(true);

    await expect(
      tool.execute(
        {
          text: 'hello',
          media: [{ type: 'image', url: 'https://example.com/image.png' }],
        },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
          sendMessage,
        },
      ),
    ).resolves.toEqual({
      content: '消息已发送: "hello"',
      details: {
        persistAsAssistantText: [
          'hello',
          '',
          '[Attachments]',
          '- image: https://example.com/image.png (image.png, image/png)',
        ].join('\n'),
      },
    });

    expect(sendMessage).toHaveBeenCalledWith({
      components: [
        { type: 'Plain', text: 'hello' },
        { type: 'Image', url: 'https://example.com/image.png' },
      ],
    });
  });

  it('send_msg returns persistence metadata without touching history', async () => {
    const tool = createSendMsgTool();

    await expect(
      tool.execute(
        { text: 'hello' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
          sendMessage: vi.fn().mockResolvedValue(true),
        },
      ),
    ).resolves.toEqual({
      content: '消息已发送: "hello"',
      details: { persistAsAssistantText: 'hello' },
    });
  });

  it('registers all built-in tools', () => {
    const registry = new ToolRegistry();

    registerBuiltinTools(registry, {
      cronManager: {
        createJob: vi.fn(),
        listJobs: vi.fn(),
        deleteJob: vi.fn(),
      },
      agentRegistry: {} as never,
      roleManager: {
        getRole: vi.fn(),
        getDefaultRole: vi.fn(),
      },
      skillManager: makeSkillManager(),
    });

    expect(registry.has('send_msg')).toBe(true);
    expect(registry.has('create_cron')).toBe(true);
    expect(registry.has('list_cron')).toBe(true);
    expect(registry.has('delete_cron')).toBe(true);
    expect(registry.has('run_sub_agent')).toBe(true);
    expect(registry.has('run_temp_sub_agent')).toBe(true);
  });

  it('load_skill reads text content from a skill directory', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    await fs.mkdir(path.join(skillDir, 'references'));
    await fs.writeFile(
      path.join(skillDir, 'references', 'guide.txt'),
      'Helpful reference',
      'utf-8',
    );

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute(
        { skillName: 'example-skill', relativePath: 'references/guide.txt' },
        makeToolContext(),
      ),
    ).resolves.toEqual({ content: 'Helpful reference' });
  });

  it('load_skill defaults omitted relativePath to SKILL.md', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Default Skill\n', 'utf-8');

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(tool.execute({ skillName: 'example-skill' }, makeToolContext())).resolves.toEqual({
      content: '# Default Skill\n',
    });
  });

  it('load_skill returns a structured error for unknown skills', async () => {
    const tool = createLoadSkillTool({ skillManager: makeSkillManager() });

    await expect(
      tool.execute({ skillName: 'missing-skill', relativePath: 'SKILL.md' }, makeToolContext()),
    ).resolves.toEqual({
      content: '技能 "missing-skill" 未加载。',
      isError: true,
      details: {
        code: 'SKILL_NOT_FOUND',
        skillName: 'missing-skill',
        relativePath: 'SKILL.md',
      },
    });
  });

  it('load_skill rejects user skills outside the current role', async () => {
    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(os.tmpdir(), 'example-skill', 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute({ skillName: 'example-skill' }, makeToolContext(makeRole([]))),
    ).resolves.toEqual({
      content: '角色无权读取技能 "example-skill"。',
      isError: true,
      details: {
        code: 'SKILL_NOT_ALLOWED',
        skillName: 'example-skill',
        relativePath: 'SKILL.md',
      },
    });
  });

  it('load_skill allows system skills without a role context', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# System Skill\n', 'utf-8');
    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'system-skill',
          description: 'System skill',
          content: 'Skill body',
          isSystem: true,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute({ skillName: 'system-skill' }, { sessionKey: SESSION_KEY }),
    ).resolves.toEqual({
      content: '# System Skill\n',
    });
  });

  it('load_skill returns a structured error for missing files', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute({ skillName: 'example-skill', relativePath: 'missing.txt' }, makeToolContext()),
    ).resolves.toEqual({
      content: '文件 "missing.txt" 在技能 "example-skill" 中不存在。',
      isError: true,
      details: {
        code: 'SKILL_FILE_NOT_FOUND',
        skillName: 'example-skill',
        relativePath: 'missing.txt',
      },
    });
  });

  it('load_skill rejects traversal outside the skill directory', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    const result = await tool.execute(
      { skillName: 'example-skill', relativePath: '../secret.txt' },
      makeToolContext(),
    );

    expect(result).toEqual({
      content: '路径 "../secret.txt" 逃逸出技能 "example-skill" 目录。',
      isError: true,
      details: {
        code: 'SKILL_PATH_TRAVERSAL_REJECTED',
        skillName: 'example-skill',
        relativePath: '../secret.txt',
      },
    });
  });

  it('load_skill rejects absolute paths', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    const absolutePath = path.join(path.parse(skillDir).root, 'absolute-secret.txt');

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute({ skillName: 'example-skill', relativePath: absolutePath }, makeToolContext()),
    ).resolves.toEqual({
      content: `路径 "${absolutePath}" 必须相对于技能 "example-skill"。`,
      isError: true,
      details: {
        code: 'SKILL_PATH_TRAVERSAL_REJECTED',
        skillName: 'example-skill',
        relativePath: absolutePath,
      },
    });
  });

  it('load_skill rejects symlink escapes outside the skill directory', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-external-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    await fs.writeFile(path.join(externalDir, 'secret.txt'), 'outside root', 'utf-8');
    await fs.symlink(externalDir, path.join(skillDir, 'linked'), 'junction');

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute(
        { skillName: 'example-skill', relativePath: 'linked/secret.txt' },
        makeToolContext(),
      ),
    ).resolves.toEqual({
      content: '路径 "linked/secret.txt" 逃逸出技能 "example-skill" 目录。',
      isError: true,
      details: {
        code: 'SKILL_PATH_TRAVERSAL_REJECTED',
        skillName: 'example-skill',
        relativePath: 'linked/secret.txt',
      },
    });
  });

  it('load_skill rejects non-text files truthfully', async () => {
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-skill-tool-'));
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# Skill\n', 'utf-8');
    await fs.writeFile(path.join(skillDir, 'binary.bin'), Buffer.from([0, 159, 146, 150]));

    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'example-skill',
          description: 'Example skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(skillDir, 'SKILL.md'),
        },
      ]),
    });

    await expect(
      tool.execute({ skillName: 'example-skill', relativePath: 'binary.bin' }, makeToolContext()),
    ).resolves.toEqual({
      content: '技能 "example-skill" 中的文件 "binary.bin" 不是可读的 UTF-8 文本文件。',
      isError: true,
      details: {
        code: 'SKILL_FILE_NOT_TEXT',
        skillName: 'example-skill',
        relativePath: 'binary.bin',
      },
    });
  });

  it('load_skill rejects skills without dedicated directory context', async () => {
    const tool = createLoadSkillTool({
      skillManager: makeSkillManager([
        {
          name: 'flat-skill',
          description: 'Flat skill',
          content: 'Skill body',
          isSystem: false,
          filePath: path.join(os.tmpdir(), 'flat-skill.md'),
        },
      ]),
    });

    await expect(
      tool.execute(
        { skillName: 'flat-skill', relativePath: 'references/guide.txt' },
        makeToolContext(),
      ),
    ).resolves.toEqual({
      content: '技能 "flat-skill" 没有专用目录上下文。',
      isError: true,
      details: {
        code: 'SKILL_HAS_NO_DIRECTORY_CONTEXT',
        skillName: 'flat-skill',
        relativePath: 'references/guide.txt',
      },
    });
  });

  it('run_sub_agent delegates to the sandbox and returns the result', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue({ newMessages: [], lastAssistant: 'delegated answer' });
    const roleManager = {
      getRole: vi.fn().mockReturnValue({
        id: 'researcher',
        name: 'Researcher',
        description: 'Research role',
        systemPrompt: 'You research topics.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist' as const, list: ['*'] },
        skills: ['*'] as ['*'],
        enabled: true,
      }),
    };
    const tool = createRunSubAgentTool({ callLLM, roleManager });
    const sendMessage = vi.fn().mockResolvedValue(true);

    await expect(
      tool.execute(
        { roleId: 'researcher', prompt: 'Investigate this.' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
          sendMessage,
        },
      ),
    ).resolves.toEqual({ content: 'delegated answer' });

    expect(callLLM).toHaveBeenCalledWith({
      role: expect.objectContaining({ id: 'researcher' }),
      content: 'Investigate this.',
      history: [],
      sessionKey: SESSION_KEY,
    });
  });

  it('run_temp_sub_agent returns structured tool errors on sandbox failure', async () => {
    const callLLM = vi.fn().mockRejectedValue(new Error('sandbox offline'));
    const roleManager = {
      getDefaultRole: vi.fn().mockReturnValue({
        id: 'default',
        name: 'Default',
        description: 'Default role',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist' as const, list: ['*'] },
        skills: ['*'] as ['*'],
        enabled: true,
      }),
    };
    const tool = createRunTempSubAgentTool({ callLLM, roleManager });

    await expect(
      tool.execute(
        { systemPrompt: 'You are concise.', prompt: 'Summarize this.' },
        makeToolContext(),
      ),
    ).resolves.toEqual({
      content: '临时子代理执行失败: sandbox offline',
      isError: true,
    });
  });

  it('run_temp_sub_agent blocks nested delegation tools when inheriting wildcard permissions', async () => {
    const callLLM = vi
      .fn()
      .mockResolvedValue({ newMessages: [], lastAssistant: 'temporary answer' });
    const roleManager = {
      getDefaultRole: vi.fn().mockReturnValue({
        id: 'default',
        name: 'Default',
        description: 'Default role',
        systemPrompt: 'You are helpful.',
        model: 'openai/gpt-4o',
        toolPermission: { mode: 'allowlist' as const, list: ['*'] },
        skills: ['*'] as ['*'],
        enabled: true,
      }),
    };
    const tool = createRunTempSubAgentTool({ callLLM, roleManager });

    await expect(
      tool.execute(
        { systemPrompt: 'You are concise.', prompt: 'Summarize this.' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
          toolPermission: { mode: 'allowlist', list: ['*'] },
        },
      ),
    ).resolves.toEqual({ content: 'temporary answer' });

    expect(callLLM).toHaveBeenCalledWith({
      role: expect.objectContaining({
        toolPermission: {
          mode: 'denylist',
          list: ['run_sub_agent', 'run_temp_sub_agent', 'send_msg'],
        },
      }),
      content: 'Summarize this.',
      history: [],
      sessionKey: SESSION_KEY,
    });
  });
});
