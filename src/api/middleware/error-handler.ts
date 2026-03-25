import type { ErrorRequestHandler } from 'express';
import { logger } from '../../observability/index.js';
import { createErrorResponse, normalizeApiError, toAppError } from '../errors.js';

const log = logger.child('APIError');

export const apiErrorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = toAppError(error);
  const requestId = req.requestId;
  const response = createErrorResponse(appError, { requestId });

  const logFields = {
    request_id: requestId,
    method: req.method,
    path: req.originalUrl,
    status: appError.statusCode,
    code: appError.code
  };

  if (appError.isOperational && appError.statusCode < 500) {
    log.warn('API request failed', {
      ...logFields,
      detail: appError.message
    });
  } else {
    log.error('Unhandled API error', {
      ...logFields,
      detail: normalizeApiError(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }

  res.status(appError.statusCode).json(response);
};
