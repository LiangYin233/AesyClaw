import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock('@/composables/useWebSocket', () => ({
  useWebSocket: () => ({ send: mocks.send }),
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

import { useConfigEditor } from '../../../extensions/plugin_webui/web/src/composables/useConfigEditor';

describe('useConfigEditor', () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.showToast.mockReset();
  });

  it('saves config when there are no extra body errors', async () => {
    mocks.send.mockResolvedValue(undefined);
    const editor = useConfigEditor();

    editor.updateConfigSection('agent', { defaultModel: 'openai/gpt-4o' });
    await editor.saveConfig();

    expect(mocks.send).toHaveBeenCalledWith('update_config', {
      agent: { defaultModel: 'openai/gpt-4o' },
    });
    expect(mocks.showToast).toHaveBeenCalledWith('toast-success', 'Configuration saved successfully');
  });

  it('blocks saving when extra body errors exist', async () => {
    const editor = useConfigEditor();
    editor.extraBodyErrors.value = { 'openai:gpt-4o': 'Invalid JSON' };

    await editor.saveConfig();

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'toast-error',
      'Fix invalid extra body JSON before saving',
    );
  });
});
