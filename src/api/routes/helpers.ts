import type { RequestHandler, Response } from 'express';
import {
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  createErrorResponse
} from '../errors.js';
import { asyncHandler, type AsyncRouteHandler } from '../middleware/async-handler.js';

type AsyncHandler = AsyncRouteHandler;

export const serverError = (res: Response, error: unknown) =>
  res.status(createErrorResponse(error, { requestId: res.req.requestId }).status)
    .json(createErrorResponse(error, { requestId: res.req.requestId }));
export const badRequest = (res: Response, message: string, field?: string) =>
  res.status(400).json(createErrorResponse(new ValidationError(message, field), { requestId: res.req.requestId }));
export const notFound = (res: Response, resource: string, id?: string) =>
  res.status(404).json(createErrorResponse(new NotFoundError(resource, id), { requestId: res.req.requestId }));
export const unavailable = (res: Response, message: string) =>
  res.status(503).json(createErrorResponse(new ServiceUnavailableError(message), { requestId: res.req.requestId }));
export const wrap = (handler: AsyncHandler): RequestHandler => asyncHandler(handler);

export function requireString(value: unknown, field: string, message?: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError(message || `${field} is required`, field);
  }
  return value;
}

export function requireObject(value: unknown, field: string, message?: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(message || `${field} must be an object`, field);
  }
  return value as Record<string, unknown>;
}
