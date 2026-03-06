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
 * Get error stack trace if available
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return undefined;
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
 * Configuration Error
 */
export class ConfigError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 'CONFIG_ERROR', 500, details);
    this.name = 'ConfigError';
  }
}

/**
 * Plugin Error
 */
export class PluginError extends AppError {
  constructor(pluginName: string, message: string, details?: any) {
    super(`Plugin "${pluginName}": ${message}`, 'PLUGIN_ERROR', 500, details);
    this.name = 'PluginError';
  }
}

/**
 * Tool Execution Error
 */
export class ToolError extends AppError {
  constructor(toolName: string, message: string, details?: any) {
    super(`Tool "${toolName}": ${message}`, 'TOOL_ERROR', 500, details);
    this.name = 'ToolError';
  }
}

/**
 * Wrap async function with error handling
 */
export function wrapAsync<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  errorHandler?: (error: unknown) => void
): T {
  return (async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (errorHandler) {
        errorHandler(error);
      }
      throw error;
    }
  }) as T;
}

/**
 * Safe JSON parse with error handling
 */
export function safeJsonParse<T = any>(json: string, defaultValue?: T): T | undefined {
  try {
    return JSON.parse(json);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Check if error is of specific type
 */
export function isErrorType(error: unknown, type: new (...args: any[]) => Error): boolean {
  return error instanceof type;
}
