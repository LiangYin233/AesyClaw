export class SessionValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'SessionValidationError';
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionKey: string) {
    super(`Session with id "${sessionKey}" not found`);
    this.name = 'SessionNotFoundError';
  }
}

export function normalizeSessionError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}
