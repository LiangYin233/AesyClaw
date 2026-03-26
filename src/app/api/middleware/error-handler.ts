import type { ErrorRequestHandler } from 'express';
import { createErrorResponse, toAppError } from '../errors.js';

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = toAppError(error);
  const requestId = req.requestId;
  const response = createErrorResponse(appError, { requestId });

  if (appError.isOperational && appError.statusCode < 500) {
  } else {
  }

  res.status(appError.statusCode).json(response);
};
