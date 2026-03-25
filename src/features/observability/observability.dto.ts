import type { LogLevel } from '../../platform/observability/index.js';
import { RequestValidationError } from '../../platform/errors/boundary.js';
import { requireObjectBody, requireString } from '../shared/requestParsers.js';

const VALID_LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export interface LoggingEntriesQueryDto {
  limit: number;
  level?: LogLevel;
}

export function parseLoggingEntriesQuery(query: { limit?: unknown; level?: unknown }): LoggingEntriesQueryDto {
  const limit = query.limit ? parseInt(String(query.limit), 10) : 200;
  if (Number.isNaN(limit) || limit <= 0) {
    throw new RequestValidationError('limit must be a positive integer', 'limit');
  }

  return {
    limit,
    level: query.level === undefined || query.level === null || query.level === ''
      ? undefined
      : parseLogLevel(query.level)
  };
}

export function parseLoggingLevelUpdate(body: unknown): { level: LogLevel } {
  const payload = requireObjectBody(body);
  return {
    level: parseLogLevel(requireString(payload.level, 'level', `level must be one of: ${VALID_LOG_LEVELS.join(', ')}`))
  };
}

function parseLogLevel(value: unknown): LogLevel {
  if (typeof value !== 'string' || !VALID_LOG_LEVELS.includes(value as LogLevel)) {
    throw new RequestValidationError(`level must be one of: ${VALID_LOG_LEVELS.join(', ')}`, 'level');
  }
  return value as LogLevel;
}
