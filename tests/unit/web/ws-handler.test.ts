import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearRecentLogEntriesForTests, createScopedLogger } from '../../../src/core/logger';
import { createWebSocketServer } from '../../../src/web/ws/handler';

const { MockWebSocket, MockWebSocketServer } = vi.hoisted(() => {
  class MockWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;

    readyState = MockWebSocket.OPEN;
    sent: string[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    send(payload: string): void {
      this.sent.push(payload);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const handlers = this.listeners.get(event) ?? [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
    }

    emit(event: string, ...args: unknown[]): void {
      for (const handler of this.listeners.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  class MockWebSocketServer {
    connectionHandler: ((ws: MockWebSocket) => void) | null = null;

    on(event: string, handler: (...args: unknown[]) => void): void {
      if (event === 'connection') {
        this.connectionHandler = handler as (ws: MockWebSocket) => void;
      }
    }

    handleUpgrade(_request: unknown, _socket: unknown, _head: unknown, callback: (ws: MockWebSocket) => void): void {
      callback(new MockWebSocket());
    }

    emit(event: string, ws: MockWebSocket): void {
      if (event === 'connection' && this.connectionHandler) {
        this.connectionHandler(ws);
      }
    }
  }

  return { MockWebSocket, MockWebSocketServer };
});

vi.mock('ws', () => {
  return {
    WebSocket: MockWebSocket,
    WebSocketServer: MockWebSocketServer,
  };
});

function createDeps() {
  return {
    configManager: {
      get: vi.fn((key: string) => {
        if (key === 'server.authToken') {
          return undefined;
        }
        return undefined;
      }),
    },
  } as Parameters<typeof createWebSocketServer>[1];
}

describe('createWebSocketServer', () => {
  beforeEach(() => {
    clearRecentLogEntriesForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearRecentLogEntriesForTests();
  });

  it('sends a log_entry message to connected clients when a log is appended', () => {
    const upgradeHandlers: Array<(request: { url?: string }, socket: { destroy: () => void; write: (chunk: string) => void }, head: Buffer) => void> = [];
    const httpServer = {
      on: vi.fn((event: string, handler: (request: { url?: string }, socket: { destroy: () => void; write: (chunk: string) => void }, head: Buffer) => void) => {
        if (event === 'upgrade') {
          upgradeHandlers.push(handler);
        }
      }),
    };

    const wss = createWebSocketServer(httpServer as never, createDeps());

    const socket = { destroy: vi.fn(), write: vi.fn() };
    const request = { url: '/api/ws' };
    const head = Buffer.alloc(0);

    upgradeHandlers[0]?.(request, socket, head);

    const wsServer = wss as unknown as MockWebSocketServer;
    const client = new MockWebSocket();
    wsServer.emit('connection', client);

    const logger = createScopedLogger('webui:test');
    logger.info('Pushed from logger', { live: true });

    expect(client.sent).toHaveLength(1);
    expect(JSON.parse(client.sent[0] as string)).toMatchObject({
      type: 'log_entry',
      ok: true,
      data: {
        level: 'info',
        scope: 'webui:test',
        message: 'Pushed from logger',
        details: '{ live: true }',
      },
    });
  });

  it('stops sending log_entry messages after the client closes', () => {
    const upgradeHandlers: Array<(request: { url?: string }, socket: { destroy: () => void; write: (chunk: string) => void }, head: Buffer) => void> = [];
    const httpServer = {
      on: vi.fn((event: string, handler: (request: { url?: string }, socket: { destroy: () => void; write: (chunk: string) => void }, head: Buffer) => void) => {
        if (event === 'upgrade') {
          upgradeHandlers.push(handler);
        }
      }),
    };

    const wss = createWebSocketServer(httpServer as never, createDeps());
    const socket = { destroy: vi.fn(), write: vi.fn() };

    upgradeHandlers[0]?.({ url: '/api/ws' }, socket, Buffer.alloc(0));

    const wsServer = wss as unknown as MockWebSocketServer;
    const client = new MockWebSocket();
    wsServer.emit('connection', client);

    client.emit('close');

    const logger = createScopedLogger('webui:test');
    logger.info('After close');

    expect(client.sent).toEqual([]);
  });
});
