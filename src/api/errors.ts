import { getConfigValidationIssue } from '../config/index.js';
import { SessionNotFoundError, SessionValidationError } from '../session/errors.js';

export interface ApiErrorResponse {
  success: false;
  title: string;
  status: number;
  detail: string;
  code: string;
  error: string;
  field?: string;
  details?: unknown;
  request_id?: string;
}

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

export class ApiNotFoundError extends NotFoundError {
  constructor(resource: string, id?: string) {
    super(resource, id);
  }
}

export function normalizeApiError(error: unknown): string {
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

function toValidationError(error: SessionValidationError): ValidationError {
  return new ValidationError(error.message, undefined, error.details);
}

function toNotFoundError(error: SessionNotFoundError): NotFoundError {
  const match = error.message.match(/"(.+)"$/);
  return new NotFoundError('Session', match?.[1]);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof SessionValidationError) {
    return toValidationError(error);
  }
  if (error instanceof SessionNotFoundError) {
    return toNotFoundError(error);
  }

  const configIssue = getConfigValidationIssue(error);
  if (configIssue) {
    return new ValidationError(configIssue.message, configIssue.field);
  }

  if (error instanceof Error) {
    return new InternalServerError();
  }

  return new InternalServerError();
}

export function createErrorResponse(
  error: unknown,
  options: {
    requestId?: string;
  } = {}
): ApiErrorResponse {
  const appError = toAppError(error);
  const response: ApiErrorResponse = {
    success: false,
    title: appError.name,
    status: appError.statusCode,
    detail: appError.message,
    code: appError.code,
    error: appError.message
  };

  if (appError instanceof ValidationError && appError.field) {
    response.field = appError.field;
  }
  if (appError.details !== undefined) {
    response.details = appError.details;
  }
  if (options.requestId) {
    response.request_id = options.requestId;
  }

  return response;
}

export function createValidationErrorResponse(message: string, field?: string): ApiErrorResponse {
  return createErrorResponse(new ValidationError(message, field));
}

export function createNotFoundErrorResponse(resource: string, id?: string): ApiErrorResponse {
  return createErrorResponse(new NotFoundError(resource, id));
}
