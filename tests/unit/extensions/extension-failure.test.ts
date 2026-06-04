import { describe, expect, it } from 'vitest';
import { ErrorCode, ErrorFactory } from '../../../src/core/errors';
import {
  createExtensionFailure,
  getExtensionFailureMessage,
  recordExtensionFailure,
  type ExtensionFailure,
} from '../../../src/extension/failure';

describe('extension failure state', () => {
  it('normalizes plain extension errors into structured extension failures', () => {
    const failure = createExtensionFailure('start', new Error('boom'), {
      extensionKind: 'plugin',
      extensionName: 'alpha',
    });

    expect(failure).toMatchObject({
      phase: 'start',
      code: ErrorCode.EXTENSION_INIT_FAILED,
      name: 'ExtensionError',
      message: 'boom',
      cause: 'boom',
      details: {
        phase: 'start',
        extensionKind: 'plugin',
        extensionName: 'alpha',
      },
    });
  });

  it('preserves existing unified error codes and details', () => {
    const failure = createExtensionFailure(
      'configReload',
      ErrorFactory.config.invalid('bad config', { configPath: 'plugins.alpha' }),
      { extensionKind: 'plugin', extensionName: 'alpha' },
    );

    expect(failure).toMatchObject({
      phase: 'configReload',
      code: ErrorCode.CONFIG_INVALID,
      name: 'ConfigurationError',
      message: 'bad config',
      details: { configPath: 'plugins.alpha' },
    });
  });

  it('records failures while preserving status API message compatibility', () => {
    const failures = new Map<string, ExtensionFailure>();

    recordExtensionFailure(failures, 'desktop', 'load', 'missing entry', {
      extensionKind: 'channel',
    });

    expect(getExtensionFailureMessage(failures, 'desktop')).toBe('missing entry');
    expect(failures.get('desktop')).toMatchObject({
      code: ErrorCode.EXTENSION_LOAD_FAILED,
      details: {
        phase: 'load',
        extensionKind: 'channel',
        extensionName: 'desktop',
      },
    });
  });
});
