import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChannelContext, ChannelPlugin } from '../../../src/extension/channel/channel-types';
import type { OutboundMessage, SessionKey } from '../../../src/core/types';
import {
  createOneBotChannel,
  extractOneBotText,
  mapOneBotEventToInbound,
  sendOneBotMessage,
} from '../../../extensions/channel_onebot/index';

let openChannels: ChannelPlugin[] = [];

describe('plugin_onebot', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.allSettled(openChannels.map((channel) => channel.destroy?.()));
    openChannels = [];

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('maps private and group OneBot message events into inbound messages', () => {
    const privateInbound = mapOneBotEventToInbound(
      {
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [
          { type: 'text', data: { text: 'hello' } },
          { type: 'image', data: { url: 'https://example.com/image.png' } },
        ],
        sender: { nickname: 'alice' },
      },
      'onebot',
    );

    expect(privateInbound).toEqual(
      expect.objectContaining({
        sessionKey: { channel: 'onebot', type: 'private', chatId: '12345' },
        content: 'hello',
        attachments: [{ type: 'image', url: 'https://example.com/image.png' }],
        sender: { id: '12345', name: 'alice' },
      }),
    );

    const groupInbound = mapOneBotEventToInbound(
      {
        post_type: 'message',
        message_type: 'group',
        group_id: 67890,
        user_id: '23456',
        message: [
          { type: 'at', data: { qq: 11111 } },
          { type: 'text', data: { text: 'hi group' } },
        ],
        sender: { card: 'member-card', nickname: 'bob', role: 'admin' },
      },
      'onebot',
    );

    expect(groupInbound).toEqual(
      expect.objectContaining({
        sessionKey: { channel: 'onebot', type: 'group', chatId: '67890' },
        content: 'hi group',
        sender: { id: '23456', name: 'member-card', role: 'admin' },
      }),
    );
  });

  it('ignores non-message events and unsupported message types', () => {
    expect(mapOneBotEventToInbound({ post_type: 'meta_event' })).toBeNull();
    expect(
      mapOneBotEventToInbound({ post_type: 'message', message_type: 'guild', user_id: 1 }),
    ).toBeNull();
  });

  it('extracts text from strings, segment arrays, and raw fallbacks', () => {
    expect(extractOneBotText('hello')).toBe('hello');
    expect(
      extractOneBotText([
        { type: 'text', data: { text: 'hello' } },
        { type: 'image', data: { file: 'image.png' } },
        { type: 'text', data: { text: ' world' } },
      ]),
    ).toBe('hello world');
    expect(extractOneBotText([{ type: 'image', data: { file: 'image.png' } }], '[CQ:image]')).toBe(
      '[CQ:image]',
    );
  });

  it('keeps reconnect timing internal and exposes only remote websocket config', () => {
    const channel = createOneBotChannel();

    expect(channel.defaultConfig).toEqual({
      enabled: false,
      serverUrl: 'ws://127.0.0.1:3001/',
      accessToken: '',
    });
    expect(channel.defaultConfig).not.toHaveProperty('reconnectIntervalMs');
    expect(channel.defaultConfig).not.toHaveProperty('requestTimeoutMs');
    expect(channel.defaultConfig).not.toHaveProperty('listenHost');
    expect(channel.defaultConfig).not.toHaveProperty('listenPort');
    expect(channel.defaultConfig).not.toHaveProperty('eventPath');
  });

  it('sends private and group messages through OneBot websocket actions', async () => {
    const sendAction = vi.fn(async () => ({ status: 'ok', retcode: 0 }));

    await sendOneBotMessage(privateSession('12345'), outbound('hello'), { sendAction });
    await sendOneBotMessage(groupSession('67890'), outbound('hi'), { sendAction });

    expect(sendAction.mock.calls).toEqual([
      ['send_private_msg', { user_id: 12345, message: 'hello' }],
      ['send_group_msg', { group_id: 67890, message: 'hi' }],
    ]);
  });

  it('uploads attachments through upload_file_stream before sending the message', async () => {
    const logger = makeLogger();
    const sendAction = vi.fn(async (action: string, params: Record<string, unknown>) => {
      if (action === 'upload_file_stream' && params.is_complete === true) {
        return {
          status: 'ok',
          retcode: 0,
          data: {
            type: 'response',
            file_path: 'C:/NapCatTemp/image.png',
          },
        };
      }

      return {
        status: 'ok',
        retcode: 0,
        data: {
          type: 'stream',
        },
      };
    });

    await sendOneBotMessage(
      groupSession('67890'),
      {
        content: 'hello',
        attachments: [
          {
            type: 'image',
            base64: Buffer.from('image-bytes').toString('base64'),
            mimeType: 'image/png',
          },
        ],
      },
      { sendAction },
      logger,
    );

    expect(sendAction).toHaveBeenNthCalledWith(
      1,
      'upload_file_stream',
      expect.objectContaining({
        chunk_index: 0,
        total_chunks: 1,
        filename: expect.stringMatching(/^image-.*\.png$/),
      }),
    );
    expect(sendAction).toHaveBeenNthCalledWith(
      2,
      'upload_file_stream',
      expect.objectContaining({
        is_complete: true,
      }),
    );
    expect(sendAction).toHaveBeenNthCalledWith(3, 'send_group_msg', {
      group_id: 67890,
      message: [
        { type: 'text', data: { text: 'hello' } },
        {
          type: 'image',
          data: {
            file: 'C:/NapCatTemp/image.png',
            file_path: 'C:/NapCatTemp/image.png',
            name: expect.stringMatching(/^image-.*\.png$/),
          },
        },
      ],
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('logs attachment upload failures before the OneBot send handoff', async () => {
    const logger = makeLogger();
    const error = new Error('upload exploded');

    await expect(
      sendOneBotMessage(
        groupSession('67890'),
        {
          content: '',
          attachments: [
            {
              type: 'image',
              base64: Buffer.from('image-bytes').toString('base64'),
              mimeType: 'image/png',
            },
          ],
        },
        {
          sendAction: async () => {
            throw error;
          },
        },
        logger,
      ),
    ).rejects.toThrow('upload exploded');

    expect(logger.error).toHaveBeenCalledWith(
      'OneBot outbound attachment upload failed',
      {
        sessionChannel: 'onebot',
        chatType: 'group',
        contentLength: 0,
        attachmentCount: 1,
        attachmentTypes: ['image'],
        stage: 'attachment-upload',
        attachmentIndex: 0,
        attachmentType: 'image',
        attachmentSource: 'base64',
      },
      error,
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
      Buffer.from('image-bytes').toString('base64'),
    );
  });

  it('logs OneBot send-stage failures after attachment upload succeeds', async () => {
    const logger = makeLogger();
    const error = new Error('bad request');

    await expect(
      sendOneBotMessage(
        groupSession('67890'),
        {
          content: 'hello',
          attachments: [
            {
              type: 'image',
              base64: Buffer.from('image-bytes').toString('base64'),
              mimeType: 'image/png',
            },
          ],
        },
        {
          sendAction: async (action, params) => {
            if (action === 'upload_file_stream') {
              if (params.is_complete === true) {
                return {
                  status: 'ok',
                  retcode: 0,
                  data: { type: 'response', file_path: 'C:/NapCatTemp/image.png' },
                };
              }

              return { status: 'ok', retcode: 0, data: { type: 'stream' } };
            }

            throw error;
          },
        },
        logger,
      ),
    ).rejects.toThrow('bad request');

    expect(logger.error).toHaveBeenCalledWith(
      'OneBot outbound message send failed',
      {
        sessionChannel: 'onebot',
        chatType: 'group',
        contentLength: 'hello'.length,
        attachmentCount: 1,
        attachmentTypes: ['image'],
        stage: 'message-send',
        action: 'send_group_msg',
      },
      error,
    );
  });

  it('rejects logical OneBot send failures', async () => {
    await expect(
      sendOneBotMessage(privateSession('12345'), outbound('hello'), {
        sendAction: async () => ({ status: 'failed', retcode: 1400, wording: 'bad request' }),
      }),
    ).rejects.toThrow(/retcode 1400/);
  });

  it('connects to a remote websocket server and replies over the same connection', async () => {
    let connectedUrl = '';
    const { channel, socket } = createTestChannel({
      onConnectedUrl: (url) => {
        connectedUrl = url;
      },
    });
    const receiveWithSend = vi.fn(async (message, send) => {
      expect(message).toEqual(
        expect.objectContaining({
          sessionKey: { channel: 'onebot', type: 'private', chatId: '12345' },
          content: 'ping',
          sender: { id: '12345', name: 'alice' },
        }),
      );
      await send({ content: 'pong' });
    });

    await openTestChannel(channel, socket, {
      config: { accessToken: 'secret-token' },
      receiveWithSend,
    });

    expect(connectedUrl).toBe('ws://napcat.remote:3001/?access_token=secret-token');

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: 'ping',
        sender: { nickname: 'alice' },
      }),
    );

    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    expect(receiveWithSend).toHaveBeenCalledOnce();
    const sentAction = JSON.parse(socket.sent[0] ?? '{}') as {
      action?: string;
      params?: Record<string, unknown>;
      echo?: string;
    };
    expect(sentAction.action).toBe('send_private_msg');
    expect(sentAction.params).toEqual({ user_id: 12345, message: 'pong' });

    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: sentAction.echo,
      }),
    );

    await flushMicrotasks();
  });

  it('downloads inbound attachment bytes to local media storage and appends file paths to content', async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'aesyclaw-onebot-download-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [
          { type: 'text', data: { text: 'see file' } },
          { type: 'image', data: { file: 'img-token', url: 'https://example.com/remote.png' } },
        ],
        sender: { nickname: 'alice' },
      }),
    );

    await flushMicrotasks();

    const downloadAction = JSON.parse(socket.sent[0] ?? '{}') as {
      action?: string;
      echo?: string;
      params?: Record<string, unknown>;
    };
    expect(downloadAction.action).toBe('download_file_image_stream');
    expect(downloadAction.params).toEqual({ file: 'img-token', chunk_size: 65536 });

    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        stream: 'stream-action',
        data: {
          type: 'stream',
          data_type: 'file_info',
          file_name: 'downloaded.png',
          file_size: 11,
          chunk_size: 65536,
        },
      }),
    );
    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        stream: 'stream-action',
        data: {
          type: 'stream',
          data_type: 'file_chunk',
          index: 0,
          data: Buffer.from('image-bytes').toString('base64'),
          size: 11,
        },
      }),
    );
    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        stream: 'stream-action',
        data: {
          type: 'response',
          data_type: 'file_complete',
          total_chunks: 1,
          total_bytes: 11,
        },
      }),
    );

    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    expect(receiveWithSend).toHaveBeenCalledOnce();
    const inbound = receiveWithSend.mock.calls[0]?.[0] as {
      content: string;
      attachments?: Array<{ path?: string; url?: string }>;
    };
    const localPath = inbound.attachments?.[0]?.path;

    expect(localPath).toBeTruthy();
    expect(localPath).toContain(path.join('.aesyclaw', 'media', 'onebot', 'inbound'));
    expect(inbound.attachments).toEqual([
      expect.objectContaining({
        type: 'image',
        path: localPath,
        url: 'https://example.com/remote.png',
      }),
    ]);
    expect(inbound.content).toContain('see file');
    expect(inbound.content).toContain('[Attachments]');
    expect(inbound.content).toContain(String(localPath));
    await expect(readFile(String(localPath), 'utf-8')).resolves.toBe('image-bytes');
  });

  it('prefers file_id when requesting generic inbound file downloads', async () => {
    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'group',
        group_id: 67890,
        user_id: 12345,
        message: [{ type: 'file', data: { file_id: 'remote-file-id', file: 'fallback-file' } }],
      }),
    );

    await flushMicrotasks();

    const downloadAction = JSON.parse(socket.sent[0] ?? '{}') as {
      action?: string;
      params?: Record<string, unknown>;
    };
    expect(downloadAction.action).toBe('download_file_stream');
    expect(downloadAction.params).toEqual({ file_id: 'remote-file-id', chunk_size: 65536 });
  });

  it('annotates inbound download failures when the stream never completes', async () => {
    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [
          { type: 'image', data: { file: 'img-token', url: 'https://example.com/remote.png' } },
        ],
      }),
    );

    await flushMicrotasks();

    const downloadAction = JSON.parse(socket.sent[0] ?? '{}') as {
      echo?: string;
    };

    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        stream: 'stream-action',
        data: {
          type: 'stream',
          data_type: 'file_chunk',
          index: 0,
          data: Buffer.from('image-bytes').toString('base64'),
          size: 11,
        },
      }),
    );
    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        stream: 'stream-action',
        data: {
          type: 'response',
        },
      }),
    );

    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    const inbound = receiveWithSend.mock.calls[0]?.[0] as {
      content: string;
      attachments?: Array<{ path?: string; url?: string }>;
    };
    expect(inbound.attachments).toEqual([
      expect.objectContaining({
        type: 'image',
        url: 'https://example.com/remote.png',
      }),
    ]);
    expect(inbound.attachments?.[0]?.path).toBeUndefined();
    expect(inbound.content).toContain('[Attachment download errors]');
    expect(inbound.content).toContain('did not return a completion response');
  });

  it('does not expose file_path-only inbound files as local attachment paths', async () => {
    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [
          { type: 'text', data: { text: 'see file' } },
          { type: 'file', data: { file_path: 'C:/NapCatTemp/report.pdf' } },
        ],
      }),
    );

    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    const inbound = receiveWithSend.mock.calls[0]?.[0] as {
      content: string;
      attachments?: Array<{ path?: string }>;
    };
    expect(inbound.attachments).toBeUndefined();
    expect(inbound.content).toContain('see file');
    expect(inbound.content).toContain('[Attachment download errors]');
    expect(inbound.content).toContain(
      'No OneBot download identifier available for file attachment',
    );
    expect(inbound.content).not.toContain('C:/NapCatTemp/report.pdf');
    expect(socket.sent).toHaveLength(0);
  });

  it('preserves URL metadata when file_path-only inbound file downloads are unsupported', async () => {
    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [
          { type: 'text', data: { text: 'see file' } },
          {
            type: 'file',
            data: {
              file_path: 'C:/NapCatTemp/report.pdf',
              url: 'https://example.com/report.pdf',
            },
          },
        ],
      }),
    );

    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    const inbound = receiveWithSend.mock.calls[0]?.[0] as {
      content: string;
      attachments?: Array<{ type?: string; path?: string; url?: string }>;
    };
    expect(inbound.attachments).toEqual([{ type: 'file', url: 'https://example.com/report.pdf' }]);
    expect(inbound.attachments?.[0]?.path).toBeUndefined();
    expect(inbound.content).toContain('[Attachment download errors]');
    expect(inbound.content).not.toContain('C:/NapCatTemp/report.pdf');
    expect(socket.sent).toHaveLength(0);
  });

  it('sends outbound channel messages through the remote websocket connection', async () => {
    const { channel, socket } = createTestChannel();
    await openTestChannel(channel, socket);

    const sendPromise = channel.send(groupSession('67890'), outbound('hello group'));
    await flushMicrotasks();

    const sentAction = JSON.parse(socket.sent[0] ?? '{}') as {
      action?: string;
      params?: Record<string, unknown>;
      echo?: string;
    };
    expect(sentAction.action).toBe('send_group_msg');
    expect(sentAction.params).toEqual({ group_id: 67890, message: 'hello group' });

    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: sentAction.echo,
      }),
    );

    await expect(sendPromise).resolves.toBeUndefined();
  });

  it('rejects pending sends when the channel is destroyed', async () => {
    const { channel, socket } = createTestChannel();
    await openTestChannel(channel, socket);

    const sendPromise = channel.send(groupSession('67890'), outbound('hello group'));
    await flushMicrotasks();

    expect(socket.sent).toHaveLength(1);

    await expect(channel.destroy?.()).resolves.toBeUndefined();
    await expect(sendPromise).rejects.toThrow(/stopped/);
  });

  it('rejects pending inbound stream downloads when the channel is destroyed without delivery', async () => {
    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [{ type: 'image', data: { file: 'img-token' } }],
      }),
    );

    await flushMicrotasks();
    expect(socket.sent).toHaveLength(1);

    await expect(channel.destroy?.()).resolves.toBeUndefined();
    await flushMicrotasks();

    expect(receiveWithSend).not.toHaveBeenCalled();
  });

  it('times out pending inbound stream downloads and ignores late stream responses', async () => {
    vi.useFakeTimers();

    const { channel, socket } = createTestChannel();
    const receiveWithSend = vi.fn(async () => undefined);
    await openTestChannel(channel, socket, { receiveWithSend });

    socket.dispatchMessage(
      JSON.stringify({
        post_type: 'message',
        message_type: 'private',
        user_id: 12345,
        message: [{ type: 'image', data: { file: 'img-token' } }],
      }),
    );

    await flushMicrotasks();
    const downloadAction = JSON.parse(socket.sent[0] ?? '{}') as {
      echo?: string;
    };

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await waitForCondition(() => receiveWithSend.mock.calls.length === 1);

    const inbound = receiveWithSend.mock.calls[0]?.[0] as {
      content: string;
      attachments?: Array<{ path?: string }>;
    };
    expect(inbound.attachments).toBeUndefined();
    expect(inbound.content).toContain('[Attachment download errors]');
    expect(inbound.content).toContain('timed out after 300000ms');

    socket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: downloadAction.echo,
        data: { type: 'response', data_type: 'file_complete' },
      }),
    );
    await flushMicrotasks();

    expect(receiveWithSend).toHaveBeenCalledOnce();
  });

  it('rejects pending sends on disconnect and reconnects with a new remote websocket', async () => {
    vi.useFakeTimers();

    const firstSocket = new FakeWebSocket();
    const secondSocket = new FakeWebSocket();
    const sockets = [firstSocket, secondSocket];
    const createSocket = vi.fn(() => {
      const next = sockets.shift();
      if (!next) {
        throw new Error('No websocket prepared');
      }
      return next;
    });
    const channel = createOneBotChannel({
      createSocket,
    });
    openChannels.push(channel);

    const initPromise = channel.init(makeChannelContext());
    firstSocket.dispatchOpen();
    await initPromise;

    const firstSendPromise = channel.send(groupSession('67890'), outbound('hello group'));
    await flushMicrotasks();
    expect(firstSocket.sent).toHaveLength(1);

    firstSocket.dispatchClose({ code: 1006, reason: 'network lost' });
    await expect(firstSendPromise).rejects.toThrow(/disconnected/);

    await vi.advanceTimersByTimeAsync(4999);
    expect(createSocket).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(createSocket).toHaveBeenCalledTimes(2);
    secondSocket.dispatchOpen();
    await flushMicrotasks();

    const secondSendPromise = channel.send(groupSession('67890'), outbound('hello again'));
    await flushMicrotasks();

    const sentAction = JSON.parse(secondSocket.sent[0] ?? '{}') as {
      echo?: string;
    };
    secondSocket.dispatchMessage(
      JSON.stringify({
        status: 'ok',
        retcode: 0,
        echo: sentAction.echo,
      }),
    );

    await expect(secondSendPromise).resolves.toBeUndefined();
  });

  it('fails fast when the remote websocket closes before opening', async () => {
    const { channel, socket } = createTestChannel();

    const initPromise = channel.init(makeChannelContext());

    socket.dispatchClose({ code: 1006, reason: 'refused' });

    await expect(initPromise).rejects.toThrow(/closed before opening/);
  });
});

class FakeWebSocket {
  readyState = 0;
  sent: string[] = [];
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.dispatch('close', { code: 1000, reason: 'closed' });
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: unknown) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchOpen(): void {
    this.readyState = 1;
    this.dispatch('open', {});
  }

  dispatchMessage(data: string): void {
    this.dispatch('message', { data });
  }

  dispatchClose(event: { code?: number; reason?: string } = {}): void {
    this.readyState = 3;
    this.dispatch('close', { code: event.code ?? 1000, reason: event.reason ?? 'closed' });
  }

  private dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function createTestChannel(options: { onConnectedUrl?: (url: string) => void } = {}): {
  channel: ChannelPlugin;
  socket: FakeWebSocket;
} {
  const socket = new FakeWebSocket();
  const channel = createOneBotChannel({
    createSocket: (url) => {
      options.onConnectedUrl?.(url);
      return socket;
    },
  });
  openChannels.push(channel);
  return { channel, socket };
}

function makeChannelContext(
  overrides: Partial<ChannelContext> & { config?: Record<string, unknown> } = {},
): ChannelContext {
  return {
    name: overrides.name ?? 'onebot',
    config: {
      serverUrl: 'ws://napcat.remote:3001/',
      ...overrides.config,
    },
    receiveWithSend: overrides.receiveWithSend ?? vi.fn(),
    logger: overrides.logger ?? makeLogger(),
  };
}

async function openTestChannel(
  channel: ChannelPlugin,
  socket: FakeWebSocket,
  options: {
    config?: Record<string, unknown>;
    receiveWithSend?: ChannelContext['receiveWithSend'];
  } = {},
): Promise<void> {
  const initPromise = channel.init(
    makeChannelContext({
      config: options.config,
      receiveWithSend: options.receiveWithSend,
    }),
  );
  socket.dispatchOpen();
  await initPromise;
}

function privateSession(chatId: string): SessionKey {
  return { channel: 'onebot', type: 'private', chatId };
}

function groupSession(chatId: string): SessionKey {
  return { channel: 'onebot', type: 'group', chatId };
}

function outbound(content: string): OutboundMessage {
  return { content };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function waitForCondition(predicate: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error('Condition not met in time');
}
