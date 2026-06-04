import { describe, expect, it } from 'vitest';
import { ErrorCode, ExtensionError } from '../../../src/core/errors';

describe('ExtensionError.fromUnknown', () => {
  it('normalizes plain errors into extension errors with phase context', () => {
    const error = ExtensionError.fromUnknown(new Error('boom'), 'start', 'plugin', 'alpha');

    expect(error).toBeInstanceOf(ExtensionError);
    expect(error.code).toBe(ErrorCode.EXTENSION_INIT_FAILED);
    expect(error.message).toBe('boom');
    expect(error.extensionKind).toBe('plugin');
    expect(error.extensionName).toBe('alpha');
    expect(error.details).toMatchObject({
      phase: 'start',
      extensionKind: 'plugin',
      extensionName: 'alpha',
    });
    expect(error.cause).toBeInstanceOf(Error);
  });

  it('preserves existing AesyClawError codes and details', () => {
    const configError = new ExtensionError(ErrorCode.CONFIG_INVALID, 'bad config', {
      configPath: 'plugins.alpha',
    });
    const error = ExtensionError.fromUnknown(configError, 'configReload', 'plugin', 'alpha');

    expect(error).toBe(configError);
    expect(error.code).toBe(ErrorCode.CONFIG_INVALID);
    expect(error.details).toMatchObject({ configPath: 'plugins.alpha' });
  });

  it('maps load/discover phases to EXTENSION_LOAD_FAILED', () => {
    const error = ExtensionError.fromUnknown('missing entry', 'load', 'channel', 'desktop');

    expect(error.code).toBe(ErrorCode.EXTENSION_LOAD_FAILED);
    expect(error.message).toBe('missing entry');
  });

  it('maps init/enable/reload phases to EXTENSION_INIT_FAILED', () => {
    for (const phase of ['start', 'enable', 'configReload', 'manualReload'] as const) {
      const error = ExtensionError.fromUnknown('fail', phase, 'plugin', 'test');
      expect(error.code).toBe(ErrorCode.EXTENSION_INIT_FAILED);
    }
  });
});
