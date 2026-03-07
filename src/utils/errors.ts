/**
 * Error Handling Utilities
 *
 * Provides standardized error handling and formatting across the application.
 */

/**
 * Normalize any error to a string message
 */
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

/**
 * Create a standardized error response object
 */
export function createErrorResponse(error: unknown): { error: string } {
  return { error: normalizeError(error) };
}

/**
 * Create a standardized validation error response
 */
export function createValidationErrorResponse(message: string, field?: string): { success: false; error: string; field?: string } {
  return {
    success: false,
    error: message,
    ...(field && { field })
  };
}


/**
 * Application Error with status code
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: any
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
      ...(this.details && { details: this.details })
    };
  }
}

/**
 * Validation Error
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

/**
 * Not Found Error
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id "${id}" not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

/**
 * Check if an error is retryable (network errors, timeouts, specific HTTP status codes)
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  const networkPatterns = [
    'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND',
    'network', 'timeout', 'ECONNRESET', 'socket'
  ];

  if (error instanceof Error) {
    const message = error.message;

    if (networkPatterns.some(pattern => message.includes(pattern))) {
      return true;
    }

    const statusMatch = message.match(/\b(40[89]|5\d{2})\b/);
    if (statusMatch && retryableStatusCodes.includes(parseInt(statusMatch[1], 10))) {
      return true;
    }
  }

  return false;
}
