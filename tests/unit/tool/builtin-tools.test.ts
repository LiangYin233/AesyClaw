import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../../../src/tool/tool-registry';
import { createSendMsgTool } from '../../../src/tool/builtin/send-msg';
import { registerBuiltinTools } from '../../../src/tool/builtin';

describe('built-in tools', () => {
  it('send_msg returns a truthful error when no send callback is available', async () => {
    const tool = createSendMsgTool();

    await expect(
      tool.execute(
        { text: 'hello' },
        {
          sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
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
          sessionKey: { channel: 'test', type: 'private', chatId: 'user-1' },
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

  it('does not register stub-only tools in the default built-in set', () => {
    const registry = new ToolRegistry();

    registerBuiltinTools(registry, {
      cronManager: {
        createJob: vi.fn(),
        listJobs: vi.fn(),
        deleteJob: vi.fn(),
      },
    });

    expect(registry.has('send_msg')).toBe(true);
    expect(registry.has('create_cron')).toBe(true);
    expect(registry.has('list_cron')).toBe(true);
    expect(registry.has('delete_cron')).toBe(true);
    expect(registry.has('run_sub_agent')).toBe(false);
    expect(registry.has('run_temp_sub_agent')).toBe(false);
    expect(registry.has('speech_to_text')).toBe(false);
    expect(registry.has('image_understanding')).toBe(false);
  });
});
