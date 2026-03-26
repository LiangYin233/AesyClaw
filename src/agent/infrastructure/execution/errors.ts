export { normalizeErrorMessage as normalizeExecutionError } from '../../../platform/errors/index.js';

export function isRetryableExecutionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
  const networkPatterns = [
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'network',
    'timeout',
    'ECONNRESET',
    'socket'
  ];

  if (networkPatterns.some((pattern) => error.message.includes(pattern))) {
    return true;
  }

  const statusMatch = error.message.match(/\b(40[89]|5\d{2})\b/);
  return !!statusMatch && retryableStatusCodes.includes(parseInt(statusMatch[1], 10));
}
