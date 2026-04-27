import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { createSendMsgTool } from '../../../src/tool/builtin/send-msg';
import { createRunSubAgentTool } from '../../../src/tool/builtin/run-sub-agent';
import { createRunTempSubAgentTool } from '../../../src/tool/builtin/run-temp-sub-agent';
import { createSpeechToTextTool } from '../../../src/tool/builtin/speech-to-text';
import { createImageUnderstandingTool } from '../../../src/tool/builtin/image-understanding';
import { createLoadSkillTool } from '../../../src/tool/builtin/load-skill';
import { registerBuiltinTools } from '../../../src/tool/builtin';
import type { Skill } from '../../../src/core/types';

const SESSION_KEY = { channel: 'test', type: 'private', chatId: 'user-1' };

function makeConfigManager() {
  return {
    get: vi.fn().mockReturnValue({
      speechToText: { provider: 'openai', model: 'whisper-1' },
      imageUnderstanding: { provider: 'openai', model: 'gpt-4o' },
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
    const tool = createSendMsgTool();

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
    ).resolves.toEqual({ content: 'Message sent: "hello"' });

    expect(sendMessage).toHaveBeenCalledWith({
      content: 'hello',
      attachments: [{ type: 'image', url: 'https://example.com/image.png' }],
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
        analyzeImage: vi.fn(),
        transcribeAudio: vi.fn(),
      },
      configManager: makeConfigManager(),
      skillManager: makeSkillManager(),
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
      content: 'Skill "missing-skill" is not loaded.',
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
      content: 'File "missing.txt" does not exist in skill "example-skill".',
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
      content: 'Path "../secret.txt" escapes skill "example-skill" directory.',
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
      content: `Path "${absolutePath}" must be relative to skill "example-skill".`,
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
      content: 'Path "linked/secret.txt" escapes skill "example-skill" directory.',
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
      content: 'File "binary.bin" in skill "example-skill" is not a readable UTF-8 text file.',
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
      content: 'Skill "flat-skill" has no dedicated directory context.',
      isError: true,
      details: {
        code: 'SKILL_HAS_NO_DIRECTORY_CONTEXT',
        skillName: 'flat-skill',
        relativePath: 'references/guide.txt',
      },
    });
  });

  it('run_sub_agent delegates to the sandbox and returns the result', async () => {
    const sandbox = {
      runWithRole: vi.fn().mockResolvedValue('delegated answer'),
    };
    const tool = createRunSubAgentTool({ sandbox });
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

    expect(sandbox.runWithRole).toHaveBeenCalledWith(
      { roleId: 'researcher', prompt: 'Investigate this.' },
      { sessionKey: SESSION_KEY, sendMessage },
    );
  });

  it('run_temp_sub_agent returns structured tool errors on sandbox failure', async () => {
    const sandbox = {
      runWithPrompt: vi.fn().mockRejectedValue(new Error('sandbox offline')),
    };
    const tool = createRunTempSubAgentTool({ sandbox });

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
      content: 'Temp sub-agent execution failed: sandbox offline',
      isError: true,
    });
  });

  it('speech_to_text loads local audio and returns a transcription', async () => {
    const filePath = await createTempFile('sample.wav', new Uint8Array([82, 73, 70, 70]));
    const llmAdapter = {
      transcribeAudio: vi.fn().mockResolvedValue('transcribed words'),
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

    expect(llmAdapter.transcribeAudio).toHaveBeenCalledWith(
      'openai/whisper-1',
      expect.objectContaining({ mimeType: 'audio/wav', fileName: 'sample.wav' }),
      'test:private:user-1',
    );
  });

  it('speech_to_text returns structured errors for unsupported providers', async () => {
    const filePath = await createTempFile('sample.wav', new Uint8Array([82, 73, 70, 70]));
    const tool = createSpeechToTextTool({
      configManager: makeConfigManager(),
      llmAdapter: {
        transcribeAudio: vi.fn().mockRejectedValue(new Error('provider unsupported')),
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
      content: 'Speech-to-text failed: provider unsupported',
      isError: true,
    });
  });

  it('image_understanding loads local images and returns analysis text', async () => {
    const filePath = await createTempFile('sample.png', new Uint8Array([137, 80, 78, 71]));
    const llmAdapter = {
      analyzeImage: vi.fn().mockResolvedValue('A tiny PNG image.'),
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

    expect(llmAdapter.analyzeImage).toHaveBeenCalledWith(
      'openai/gpt-4o',
      'What is shown?',
      expect.objectContaining({ mimeType: 'image/png' }),
      'test:private:user-1',
    );
  });

  it('image_understanding returns structured tool errors for source failures', async () => {
    const tool = createImageUnderstandingTool({
      configManager: makeConfigManager(),
      llmAdapter: {
        analyzeImage: vi.fn(),
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
    expect(result.content).toContain('Image understanding failed:');
  });
});
