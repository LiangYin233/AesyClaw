import { errorMessage } from '@aesyclaw/core/utils';

export type ExtensionFailurePhase =
  | 'discover'
  | 'load'
  | 'start'
  | 'enable'
  | 'configReload'
  | 'manualReload';

export type ExtensionFailure = {
  phase: ExtensionFailurePhase;
  message: string;
  at: string;
};

export function createExtensionFailure(
  phase: ExtensionFailurePhase,
  err: unknown,
): ExtensionFailure {
  return {
    phase,
    message: errorMessage(err),
    at: new Date().toISOString(),
  };
}

export function recordExtensionFailure(
  failures: Map<string, ExtensionFailure>,
  key: string,
  phase: ExtensionFailurePhase,
  err: unknown,
): void {
  failures.set(key, createExtensionFailure(phase, err));
}

export function getExtensionFailureMessage(
  failures: Map<string, ExtensionFailure>,
  key: string,
): string | undefined {
  return failures.get(key)?.message;
}
