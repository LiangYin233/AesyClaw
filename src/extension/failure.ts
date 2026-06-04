import {
  AesyClawError,
  ErrorCode,
  ExtensionError,
  errorMessage,
  type ErrorDetails,
  type ExtensionKind,
} from '@aesyclaw/core/errors';

export type ExtensionFailurePhase =
  | 'discover'
  | 'load'
  | 'start'
  | 'enable'
  | 'configReload'
  | 'manualReload';

export type ExtensionFailureContext = {
  extensionKind?: string;
  extensionName?: string;
};

export type ExtensionFailure = {
  phase: ExtensionFailurePhase;
  code: ErrorCode;
  name: string;
  message: string;
  details?: ErrorDetails;
  cause?: string;
  at: string;
};

export function createExtensionFailure(
  phase: ExtensionFailurePhase,
  err: unknown,
  context: ExtensionFailureContext = {},
): ExtensionFailure {
  const error = normalizeExtensionFailureError(phase, err, context);
  const failure: ExtensionFailure = {
    phase,
    code: error.code,
    name: error.name,
    message: error.message,
    at: new Date().toISOString(),
  };

  if (error.details !== undefined) {
    failure.details = error.details;
  }
  if (error.cause !== undefined) {
    failure.cause = error.cause.message;
  }

  return failure;
}

export function recordExtensionFailure(
  failures: Map<string, ExtensionFailure>,
  key: string,
  phase: ExtensionFailurePhase,
  err: unknown,
  context: ExtensionFailureContext = {},
): void {
  failures.set(key, createExtensionFailure(phase, err, { extensionName: key, ...context }));
}

export function getExtensionFailureMessage(
  failures: Map<string, ExtensionFailure>,
  key: string,
): string | undefined {
  return failures.get(key)?.message;
}

function normalizeExtensionFailureError(
  phase: ExtensionFailurePhase,
  err: unknown,
  context: ExtensionFailureContext,
): AesyClawError {
  if (AesyClawError.isAesyClawError(err)) {
    return err;
  }

  return new ExtensionError(
    phaseToErrorCode(phase),
    errorMessage(err),
    {
      phase,
      extensionKind: normalizeExtensionKind(context.extensionKind),
      extensionName: context.extensionName,
    },
    err instanceof Error ? err : undefined,
  );
}

function phaseToErrorCode(phase: ExtensionFailurePhase): ErrorCode {
  switch (phase) {
    case 'discover':
    case 'load':
      return ErrorCode.EXTENSION_LOAD_FAILED;
    case 'start':
    case 'enable':
    case 'configReload':
    case 'manualReload':
      return ErrorCode.EXTENSION_INIT_FAILED;
  }
}

function normalizeExtensionKind(kind: string | undefined): ExtensionKind {
  switch (kind?.toLowerCase()) {
    case 'plugin':
      return 'plugin';
    case 'channel':
      return 'channel';
    default:
      return 'extension';
  }
}
