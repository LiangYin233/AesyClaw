import { describe, expect, it, vi } from 'vitest';

const getUpdatesMock = vi.hoisted(() => vi.fn());

vi.mock('../../../extensions/channel_weixin/api', () => ({
  getUpdates: getUpdatesMock,
}));

import { startMonitor } from '../../../extensions/channel_weixin/monitor';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('channel_weixin monitor', () => {
  it('aborts active polling and suppresses messages after stop', async () => {
    let resolveUpdates: (value: unknown) => void = () => undefined;
    getUpdatesMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpdates = resolve;
        }),
    );

    const onMessage = vi.fn();
    const monitor = startMonitor(
      { baseUrl: 'https://example.test/', token: 'token' },
      { onMessage, onError: vi.fn() },
      logger,
    );

    await vi.waitFor(() => expect(getUpdatesMock).toHaveBeenCalledTimes(1));
    const signal = getUpdatesMock.mock.calls[0]?.[0]?.abortSignal as AbortSignal;

    monitor.stop();

    expect(signal.aborted).toBe(true);
    resolveUpdates({
      ret: 0,
      get_updates_buf: 'next',
      msgs: [{ from_user_id: 'user-1', item_list: [{ type: 1, text_item: { text: 'hello' } }] }],
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(onMessage).not.toHaveBeenCalled();
    expect(monitor.getUpdatesBuf()).toBe('');
  });
});
