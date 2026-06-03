import { describe, expect, it, vi } from 'vitest';
import {
  fileToMessageComponent,
  formatAttachmentText,
  sanitizeFileName,
  sanitizePathSegment,
} from '../../../extensions/channel_desktop/attachments';
import { validateDesktopToken } from '../../../extensions/channel_desktop/auth';
import { DesktopServer } from '../../../extensions/channel_desktop/desktop-server';
import type { ChannelContext } from '../../../src/extension/channel/types';

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeContext(overrides: Partial<ChannelContext> = {}): ChannelContext {
  return {
    name: 'desktop',
    config: {},
    configManager: {} as ChannelContext['configManager'],
    paths: {} as ChannelContext['paths'],
    receive: vi.fn(async () => undefined),
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    registerCommand: vi.fn(),
    getCommands: vi.fn(() => []),
    logger: makeLogger(),
    ...overrides,
  };
}

type CancelableDesktopServer = {
  handleCancelMessage(
    connectionId: string,
    msg: { type: 'cancel'; sessionId: string },
  ): Promise<void>;
};

type ConfigDesktopServer = {
  handleConfigRequest(
    connectionId: string,
    msg: {
      type: 'config_request';
      requestId: string;
      action: 'get_config' | 'update_config';
      data?: unknown;
    },
  ): Promise<void>;
};

type QueryDesktopServer = {
  handleGetSessions(
    connectionId: string,
    msg: { type: 'get_sessions'; requestId?: string },
  ): Promise<void>;
  handleGetSessionMessages(
    connectionId: string,
    msg: { type: 'get_session_messages'; requestId?: string; sessionId: string },
  ): Promise<void>;
};

function registerTestConnection(server: DesktopServer, id = 'conn-1'): unknown[] {
  const sent: unknown[] = [];
  server.sessions.register({
    id,
    sessions: new Set(),
    fileBuffers: new Map(),
    completedFiles: new Map(),
    sendJson: (data: unknown) => sent.push(data),
    sendBinary: vi.fn(),
    close: vi.fn(),
  });
  return sent;
}

describe('DesktopServer', () => {
  it('routes cancel messages through the stop command path', async () => {
    const context = makeContext();
    const server = new DesktopServer({
      port: 0,
      authToken: 'desktop-local',
      adminToken: 'admin-local',
      context,
    });

    await (server as unknown as CancelableDesktopServer).handleCancelMessage('conn-abcdef12', {
      type: 'cancel',
      sessionId: 'session-1',
    });

    expect(context.receive).toHaveBeenCalledWith(
      { components: [{ type: 'Plain', text: '/stop' }] },
      { channel: 'desktop', type: 'private', chatId: 'session-1' },
      { id: 'conn-abcdef12', name: 'Desktop-conn-abc' },
    );
  });

  it('responds to session list requests with request ids', async () => {
    const sessions = [{ id: 'db-session', channel: 'desktop', type: 'private', chatId: 'chat-1' }];
    const context = makeContext({ getSessions: vi.fn(async () => sessions) as never });
    const server = new DesktopServer({
      port: 0,
      authToken: 'desktop-local',
      adminToken: 'admin-local',
      context,
    });
    const sent = registerTestConnection(server);
    const otherSent = registerTestConnection(server, 'conn-2');

    await (server as unknown as QueryDesktopServer).handleGetSessions('conn-1', {
      type: 'get_sessions',
      requestId: 'sessions-req',
    });

    expect(sent[0]).toEqual({
      type: 'sessions',
      requestId: 'sessions-req',
      data: sessions,
    });
    expect(otherSent).toHaveLength(0);
  });

  it('responds to session message requests with request ids', async () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const context = makeContext({ getSessionMessages: vi.fn(async () => messages) as never });
    const server = new DesktopServer({
      port: 0,
      authToken: 'desktop-local',
      adminToken: 'admin-local',
      context,
    });
    const sent = registerTestConnection(server);

    await (server as unknown as QueryDesktopServer).handleGetSessionMessages('conn-1', {
      type: 'get_session_messages',
      requestId: 'messages-req',
      sessionId: 'chat-1',
    });

    expect(sent[0]).toEqual({
      type: 'session_messages',
      requestId: 'messages-req',
      sessionId: 'chat-1',
      data: messages,
    });
  });

  it('serves config snapshots over the desktop channel websocket', async () => {
    const config = {
      server: { port: 3000 },
      providers: {},
      channels: { desktop: { enabled: true } },
      agent: { defaultModel: 'openai/gpt-4o' },
      mcp: [],
      plugins: {},
    };
    const context = makeContext({
      configManager: {
        get: vi.fn((key: keyof typeof config) => config[key]),
        set: vi.fn(),
        patch: vi.fn(),
      } as never,
    });
    const server = new DesktopServer({
      port: 0,
      authToken: 'desktop-local',
      adminToken: 'admin-local',
      context,
    });
    const sent = registerTestConnection(server);

    await (server as unknown as ConfigDesktopServer).handleConfigRequest('conn-1', {
      type: 'config_request',
      requestId: 'req-1',
      action: 'get_config',
    });

    expect(sent[0]).toEqual({
      type: 'config_response',
      requestId: 'req-1',
      action: 'get_config',
      ok: true,
      data: config,
    });
  });

  it('updates config over the desktop channel websocket', async () => {
    const configManager = {
      get: vi.fn(),
      set: vi.fn(async () => undefined),
      patch: vi.fn(async () => undefined),
      update: vi.fn(async () => undefined),
      onConfigReloaded: vi.fn(),
    };
    const context = makeContext({ configManager: configManager as never });
    const server = new DesktopServer({
      port: 0,
      authToken: 'desktop-local',
      adminToken: 'admin-local',
      context,
    });
    const sent = registerTestConnection(server);

    await (server as unknown as ConfigDesktopServer).handleConfigRequest('conn-1', {
      type: 'config_request',
      requestId: 'req-2',
      action: 'update_config',
      data: { plugins: { exec: { enabled: false } } },
    });

    expect(configManager.update).toHaveBeenCalledWith({ plugins: { exec: { enabled: false } } });
    expect(configManager.set).not.toHaveBeenCalled();
    expect(configManager.patch).not.toHaveBeenCalled();
    expect(configManager.onConfigReloaded).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({
      type: 'config_response',
      requestId: 'req-2',
      action: 'update_config',
      ok: true,
    });
  });
});

it('validates desktop websocket auth tokens safely', () => {
  expect(validateDesktopToken('/ws?token=desktop-local', 'desktop-local')).toBe(true);
  expect(validateDesktopToken('/ws?token=wrong', 'desktop-local')).toBe(false);
  expect(validateDesktopToken('/ws', 'desktop-local')).toBe(false);
  expect(validateDesktopToken(undefined, 'desktop-local')).toBe(false);
});

it('sanitizes attachment names and maps files to message components', () => {
  expect(sanitizeFileName('../bad:name.png')).toBe('.._bad_name.png');
  expect(sanitizeFileName('   ')).toBe('upload.bin');
  expect(sanitizePathSegment('../session id')).toBe('.._session_id');

  const file = {
    fileId: 'file-1',
    sessionId: 'session-1',
    name: 'photo.png',
    mime: 'image/png',
    size: 3,
    filePath: '/media/photo.png',
  };

  expect(fileToMessageComponent(file)).toMatchObject({
    type: 'Image',
    path: '/media/photo.png',
    name: 'photo.png',
    mimeType: 'image/png',
  });
  expect(formatAttachmentText([file])).toContain('- image: /media/photo.png');
});
