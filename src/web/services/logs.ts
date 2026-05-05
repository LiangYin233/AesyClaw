/** 日志 Service。 */

import { getRecentLogEntries, createScopedLogger } from '@aesyclaw/core/logger';

const DEFAULT_LOG_LIMIT = 200;
const MAX_LOG_LIMIT = 500;
const logger = createScopedLogger('webui:logs');

function parseLimit(limitRaw: string | undefined): number {
  if (!limitRaw) {
    return DEFAULT_LOG_LIMIT;
  }
  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_LOG_LIMIT;
  }
  return Math.min(parsed, MAX_LOG_LIMIT);
}

type LogQuery = {
  limit?: string;
};

/**
 * 获取最近日志条目。
 */
export function getLogs(params?: LogQuery): {
  entries: ReturnType<typeof getRecentLogEntries>;
  limit: number;
} {
  try {
    const limit = parseLimit(params?.limit);
    const entries = getRecentLogEntries(limit);
    return { entries, limit };
  } catch (err) {
    logger.error('获取最近日志失败', err);
    throw new Error('获取最近日志失败', { cause: err });
  }
}
