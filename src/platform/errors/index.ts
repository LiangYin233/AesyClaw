export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    public readonly isOperational: boolean = true,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'BAD_REQUEST', 400, true, details);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly field?: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, true, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class NotFoundError extends AppError {
  constructor(public readonly resource: string, public readonly id?: string) {
    super(id ? `${resource} with id "${id}" not found` : `${resource} not found`, 'NOT_FOUND', 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'CONFLICT', 409, true, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable', details?: unknown) {
    super(message, 'SERVICE_UNAVAILABLE', 503, true, details);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 'INTERNAL_ERROR', 500, false);
  }
}

export function normalizeErrorMessage(error: unknown): string {
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
