import type { Request, RequestHandler, Response } from 'express';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../errors/index.js';

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

export const serverError = (res: Response, error: unknown) => res.status(500).json(createErrorResponse(error));
export const badRequest = (res: Response, message: string, field?: string) =>
  res.status(400).json(createValidationErrorResponse(message, field));
export const notFound = (res: Response, resource: string, id?: string) =>
  res.status(404).json(createErrorResponse(new NotFoundError(resource, id)));
export const unavailable = (res: Response, message: string) => res.status(503).json(createErrorResponse(new Error(message)));
export const wrap = (handler: AsyncHandler): RequestHandler => (req, res) => void handler(req, res).catch((error) => serverError(res, error));
