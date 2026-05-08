import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockSocketMessage = {
  type: string;
  data?: unknown;
  requestId?: string;
  ok?: boolean;
  error?: string;
};

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: MockSocketMessage[] = [];

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload) as MockSocketMessage);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emit(message: MockSocketMessage): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }
}

async function loadUseWebSocket() {
  return await import('../../../web/src/composables/useWebSocket');
}

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    MockWebSocket.instances = [];
    vi.stubGlobal('window', {
      location: {
        protocol: 'https:',
        host: 'example.test',
      },
    });
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('keeps concurrent get_status requests separate', async () => {
    const { useWebSocket } = await loadUseWebSocket();
    const ws = useWebSocket();

    ws.connect('test-token');
    await vi.runOnlyPendingTimersAsync();

    const socket = MockWebSocket.instances[0];
    if (!socket) {
      throw new Error('Expected a mocked WebSocket instance');
    }

    const first = ws.send('get_status', { source: 'dashboard' }, 1000);
    const second = ws.send('get_status', { source: 'layout' }, 1000);

    await Promise.resolve();

    expect(socket.sent).toHaveLength(2);
    expect(socket.sent[0].requestId).toBeDefined();
    expect(socket.sent[1].requestId).toBeDefined();
    expect(socket.sent[0].requestId).not.toBe(socket.sent[1].requestId);

    socket.emit({
      type: 'get_status',
      ok: true,
      requestId: socket.sent[0].requestId,
      data: { source: 'dashboard' },
    });
    socket.emit({
      type: 'get_status',
      ok: true,
      requestId: socket.sent[1].requestId,
      data: { source: 'layout' },
    });

    await expect(first).resolves.toEqual({ source: 'dashboard' });
    await expect(second).resolves.toEqual({ source: 'layout' });
  });
});
