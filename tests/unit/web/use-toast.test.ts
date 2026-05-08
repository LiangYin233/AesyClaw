import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadUseToast() {
  return await import('../../../web/src/composables/useToast');
}

describe('useToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('shares one toast ref across useToast calls', async () => {
    const { useToast } = await loadUseToast();
    const first = useToast();
    const second = useToast();

    first.showToast('toast-success', 'Saved');

    expect(second.toast).toBe(first.toast);
    expect(second.toast.value).toEqual({
      type: 'toast-success',
      message: 'Saved',
    });
  });

  it('replaces an old timer and clears only after the latest toast expires', async () => {
    const { useToast } = await loadUseToast();
    const { toast, showToast } = useToast();

    showToast('toast-success', 'Saved');
    vi.advanceTimersByTime(2999);

    showToast('toast-error', 'Failed');
    vi.advanceTimersByTime(1);

    expect(toast.value).toEqual({
      type: 'toast-error',
      message: 'Failed',
    });

    vi.advanceTimersByTime(2999);

    expect(toast.value).toBeNull();
  });
});
