import type { RequestHandler } from 'express';
import { logger } from '../../observability/index.js';

const log = logger.child('HTTP');

export const accessLogMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    log.info('API request completed', {
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration_ms: Math.round(durationMs * 1000) / 1000
    });
  });

  next();
};
