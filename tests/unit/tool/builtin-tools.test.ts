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
import { registerBuiltinTools } from '../../../src/tool/builtin';

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
    });

    expect(registry.has('send_msg')).toBe(true);
    expect(registry.has('create_cron')).toBe(true);
    expect(registry.has('list_cron')).toBe(true);
    expect(registry.has('delete_cron')).toBe(true);
    expect(registry.has('run_sub_agent')).toBe(true);
    expect(registry.has('run_temp_sub_agent')).toBe(true);
    expect(registry.has('speech_to_text')).toBe(true);
    expect(registry.has('image_understanding')).toBe(true);
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
