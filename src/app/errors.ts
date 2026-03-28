import { getConfigValidationIssue } from '../features/config/index.js';
import {
  AppError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  normalizeErrorMessage
} from '../platform/errors/index.js';
import {
  BoundaryError,
  RequestValidationError
} from '../platform/errors/boundary.js';
import {
  DependencyUnavailableError,
  DomainConflictError,
  DomainError,
  DomainValidationError,
  ResourceNotFoundError
} from '../platform/errors/domain.js';
import { SessionNotFoundError, SessionValidationError } from '../features/sessions/domain/types.js';

export {
  AppError,
  BadRequestError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError
} from '../platform/errors/index.js';

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

export class ApiNotFoundError extends NotFoundError {
  constructor(resource: string, id?: string) {
    super(resource, id);
  }
}

export function normalizeApiError(error: unknown): string {
  return normalizeErrorMessage(error);
}

function toValidationError(error: SessionValidationError): ValidationError {
  return new ValidationError(error.message, undefined, error.details);
}

function toNotFoundError(error: SessionNotFoundError): NotFoundError {
  const match = error.message.match(/"(.+)"$/);
  return new NotFoundError('Session', match?.[1]);
}

function mapDomainError(error: DomainError): AppError {
  if (error instanceof DomainValidationError) {
    return new ValidationError(error.message, error.field, error.details);
  }
  if (error instanceof ResourceNotFoundError) {
    return new NotFoundError(error.resource, error.id);
  }
  if (error instanceof DomainConflictError) {
    return new ConflictError(error.message, error.details);
  }
  if (error instanceof DependencyUnavailableError) {
    return new ServiceUnavailableError(error.message, error.details);
  }

  return new InternalServerError();
}

function mapBoundaryError(error: BoundaryError): AppError {
  if (error instanceof RequestValidationError) {
    return new ValidationError(error.message, error.field, error.details);
  }

  return new BadRequestError(error.message, error.details);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (error instanceof BoundaryError) {
    return mapBoundaryError(error);
  }
  if (error instanceof DomainError) {
    return mapDomainError(error);
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
