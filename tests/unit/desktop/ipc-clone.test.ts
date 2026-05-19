import { describe, expect, it } from 'vitest';
import { reactive } from 'vue';
import { toIpcCloneable } from '../../../desktop/src/shared/ipc-clone';

describe('toIpcCloneable', () => {
  it('converts proxied config payloads into structured-cloneable plain objects', () => {
    const payload = new Proxy(
      {
        providers: {
          openai: new Proxy(
            {
              apiKey: 'sk-test',
              models: [{ name: 'gpt-4o', extraBody: { reasoning: { effort: 'low' } } }],
            },
            {},
          ),
        },
      },
      {},
    );

    expect(() => structuredClone(payload)).toThrow(/could not be cloned/i);

    const cloneable = toIpcCloneable(payload);

    expect(cloneable).toEqual({
      providers: {
        openai: {
          apiKey: 'sk-test',
          models: [{ name: 'gpt-4o', extraBody: { reasoning: { effort: 'low' } } }],
        },
      },
    });
    expect(() => structuredClone(cloneable)).not.toThrow();
  });

  it('converts Vue reactive config sections before crossing the preload bridge', () => {
    const sectionValue = reactive({
      channels: { desktop: { enabled: true } },
    });
    const payload = { channels: sectionValue.channels };

    expect(() => structuredClone(payload)).toThrow(/could not be cloned/i);

    const cloneable = toIpcCloneable(payload);

    expect(cloneable).toEqual({ channels: { desktop: { enabled: true } } });
    expect(() => structuredClone(cloneable)).not.toThrow();
  });
});
