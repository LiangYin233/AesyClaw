import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { completeSimple } from '@mariozechner/pi-ai';
import type * as PiAiModule from '@mariozechner/pi-ai';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { createSendMsgTool } from '../../../src/tool/builtin/send-msg';
import { createRunSubAgentTool, createRunTempSubAgentTool } from '../../../src/tool/builtin/run-sub-agent';
import { createLoadSkillTool } from '../../../src/tool/builtin/load-skill';
import {
  registerBuiltinTools,
  createSpeechToTextTool,
  createImageUnderstandingTool,
} from '../../../src/tool/builtin';
import type { Skill } from '../../../src/core/types';

vi.mock('@mariozechner/pi-ai', async () => {
  const actual = await vi.importActual<typeof PiAiModule>('@mariozechner/pi-ai');
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

function makeConfigManager() {
  return {
    get: vi.fn().mockImplementation((key: string) => {
      if (key === 'agent.multimodal') {
        return {
          speechToText: { provider: 'openai', model: 'whisper-1' },
          imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
        };
      }
      return undefined;
    }),
  };
}

async function createTempFile(name: string, content: Uint8Array): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aesyclaw-tool-test-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, content);
  return filePath;
}

function makeSkillManager(skills: Skill[] = []) {
  const skillMap = new Map(skills.map((skill) => [skill.name, skill]));
  return {
    getSkill: vi.fn((name: string) => skillMap.get(name)),
  };
}

describe('built-in tools', () => {
  it('send_msg returns a truthful error when no send callback is available', async () => {
    const tool = createSendMsgTool({ sessionManager: { get: vi.fn().mockReturnValue(undefined) } });

    await expect(
      tool.execute(
        { text: 'hello' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        isError: true,
      }),
    );
  });

  it('send_msg uses the provided outbound send callback', async () => {
    const tool = createSendMsgTool({ sessionManager: { get: vi.fn().mockReturnValue(undefined) } });
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
    ).resolves.toEqual({ content: '消息已发送: "hello"' });

    expect(sendMessage).toHaveBeenCalledWith({
      components: [
        { type: 'Plain', text: 'hello' },
        { type: 'Image', url: 'https://example.com/image.png' },
      ],
    });
  });

  it('registers sub-agent and multimodal tools in the default built-in set', () => {
    const registry = new ToolRegistry();

    registerBuiltinTools(registry, {
      cronManager: {
        createJob: vi.fn(),
        listJobs: vi.fn(),
        deleteJob: vi.fn(),
      },
      agentEngine: {
        createAgent: vi.fn(),
        process: vi.fn(),
      },
      roleManager: {
        getRole: vi.fn(),
        getDefaultRole: vi.fn(),
      },
      llmAdapter: {
        resolveModel: vi.fn(),
      },
      configManager: makeConfigManager(),
      skillManager: makeSkillManager(),
      sessionManager: { get: vi.fn() },
    });

    expect(registry.has('send_msg')).toBe(true);
    expect(registry.has('create_cron')).toBe(true);
    expect(registry.has('list_cron')).toBe(true);
    expect(registry.has('delete_cron')).toBe(true);
    expect(registry.has('run_sub_agent')).toBe(true);
    expect(registry.has('run_temp_sub_agent')).toBe(true);
    expect(registry.has('load_skill')).toBe(true);
    expect(registry.has('speech_to_text')).toBe(true);
    expect(registry.has('image_understanding')).toBe(true);
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
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
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

    await expect(
      tool.execute(
        { skillName: 'example-skill' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual({ content: '# Default Skill\n' });
  });

  it('load_skill returns a structured error for unknown skills', async () => {
    const tool = createLoadSkillTool({ skillManager: makeSkillManager() });

    await expect(
      tool.execute(
        { skillName: 'missing-skill', relativePath: 'SKILL.md' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
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
      tool.execute(
        { skillName: 'example-skill', relativePath: 'missing.txt' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
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
      {
        sessionKey: SESSION_KEY,
        agentEngine: null,
        cronManager: null,
      },
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
      tool.execute(
        { skillName: 'example-skill', relativePath: absolutePath },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
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
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
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
      tool.execute(
        { skillName: 'example-skill', relativePath: 'binary.bin' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
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
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
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
    const runTurn = vi
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
    const tool = createRunSubAgentTool({ runTurn, roleManager });
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

    expect(runTurn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'researcher' }),
      'Investigate this.',
      [],
      SESSION_KEY,
    );
  });

  it('run_temp_sub_agent returns structured tool errors on sandbox failure', async () => {
    const runTurn = vi.fn().mockRejectedValue(new Error('sandbox offline'));
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
    const tool = createRunTempSubAgentTool({ runTurn, roleManager });

    await expect(
      tool.execute(
        { systemPrompt: 'You are concise.', prompt: 'Summarize this.' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual({
      content: '临时子代理执行失败: sandbox offline',
      isError: true,
    });
  });

  it('speech_to_text loads local audio and returns a transcription', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ text: 'transcribed words' }),
        text: vi.fn().mockResolvedValue(''),
      }),
    );
    const filePath = await createTempFile('sample.wav', new Uint8Array([82, 73, 70, 70]));
    const llmAdapter = {
      resolveModel: vi.fn().mockReturnValue({
        provider: 'openai',
        modelId: 'whisper-1',
        apiKey: 'sk-test-key',
        apiType: 'openai-responses',
        baseUrl: 'https://api.openai.com/v1/',
      }),
    };
    const tool = createSpeechToTextTool({
      configManager: makeConfigManager(),
      llmAdapter,
    });

    await expect(
      tool.execute(
        { source: filePath },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual({ content: 'transcribed words' });

    expect(llmAdapter.resolveModel).toHaveBeenCalledWith('openai/whisper-1');
  });

  it('speech_to_text returns structured errors for unsupported providers', async () => {
    const filePath = await createTempFile('sample.wav', new Uint8Array([82, 73, 70, 70]));
    const tool = createSpeechToTextTool({
      configManager: makeConfigManager(),
      llmAdapter: {
        resolveModel: vi.fn().mockReturnValue({
          provider: 'openai',
          modelId: 'whisper-1',
          apiKey: 'sk-test-key',
          apiType: 'anthropic-messages',
          baseUrl: 'https://api.anthropic.com',
        }),
      },
    });

    await expect(
      tool.execute(
        { source: filePath },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual({
      content: '语音转文本失败: 提供者 API 类型 "anthropic-messages" 不支持语音转文本',
      isError: true,
    });
  });

  it('image_understanding loads local images and returns analysis text', async () => {
    vi.mocked(completeSimple).mockResolvedValue({
      role: 'assistant',
      content: [{ type: 'text', text: 'A tiny PNG image.' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-4o',
      usage: {
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 15,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    });
    const filePath = await createTempFile('sample.png', new Uint8Array([137, 80, 78, 71]));
    const llmAdapter = {
      resolveModel: vi.fn().mockReturnValue({
        provider: 'openai',
        modelId: 'gpt-4o',
        apiKey: 'sk-test-key',
        apiType: 'openai-responses',
        input: ['text', 'image'],
      }),
    };
    const tool = createImageUnderstandingTool({
      configManager: makeConfigManager(),
      llmAdapter,
    });

    await expect(
      tool.execute(
        { source: filePath, question: 'What is shown?' },
        {
          sessionKey: SESSION_KEY,
          agentEngine: null,
          cronManager: null,
        },
      ),
    ).resolves.toEqual({ content: 'A tiny PNG image.' });

    expect(llmAdapter.resolveModel).toHaveBeenCalledWith('openai/gpt-4o');
  });

  it('image_understanding returns structured tool errors for source failures', async () => {
    const tool = createImageUnderstandingTool({
      configManager: makeConfigManager(),
      llmAdapter: {
        resolveModel: vi.fn(),
      },
    });

    const result = await tool.execute(
      { source: 'missing-image.png' },
      {
        sessionKey: SESSION_KEY,
        agentEngine: null,
        cronManager: null,
      },
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('图片理解失败:');
  });
});
