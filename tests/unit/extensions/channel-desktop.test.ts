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
