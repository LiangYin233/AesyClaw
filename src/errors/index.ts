export function normalizeError(error: unknown): string {
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

export function createErrorResponse(error: unknown): { error: string } {
  return { error: normalizeError(error) };
}

export function createValidationErrorResponse(
  message: string,
  field?: string
): { success: false; error: string; field?: string } {
  return {
    success: false,
    error: message,
    ...(field ? { field } : {})
  };
}

export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details ? { details: this.details } : {})
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id "${id}" not found` : `${resource} not found`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export function isRetryableError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  const networkPatterns = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'network',
    'timeout',
    'ECONNRESET',
    'socket'
  ];

  if (!(error instanceof Error)) {
    return false;
  }

  if (networkPatterns.some((pattern) => error.message.includes(pattern))) {
    return true;
  }

  const statusMatch = error.message.match(/\b(40[89]|5\d{2})\b/);
  return !!statusMatch && retryableStatusCodes.includes(parseInt(statusMatch[1], 10));
}
