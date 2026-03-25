export function normalizeProviderError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return String(error);
}

export function isRetryableProviderError(error: unknown): boolean {
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
