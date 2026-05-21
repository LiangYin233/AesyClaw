import { timingSafeEqual } from 'node:crypto';

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

export function validateDesktopToken(url: string | undefined, expectedToken: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url, 'http://localhost');
    const token = parsed.searchParams.get('token');
    if (!token) return false;
    return safeTokenEqual(token, expectedToken);
  } catch {
    return false;
  }
}
