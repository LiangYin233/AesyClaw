import { RequestValidationError } from '../../platform/errors/boundary.js';

export function requireObjectBody(body: unknown, field = 'body', message = 'request body must be an object'): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError(message, field);
  }
  return body as Record<string, unknown>;
}

export function requireString(value: unknown, field: string, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RequestValidationError(message, field);
  }
  return value.trim();
}

export function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${field} must be a string`, field);
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function requireBoolean(value: unknown, field: string, message: string): boolean {
  if (typeof value !== 'boolean') {
    throw new RequestValidationError(message, field);
  }
  return value;
}

export function requireRecord(value: unknown, field: string, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestValidationError(message, field);
  }
  return value as Record<string, unknown>;
}
