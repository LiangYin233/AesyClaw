import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const SESSION_COOKIE = 'aesyclaw_session';
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_FAILURES = 10;

type SessionRecord = {
  tokenFingerprint: string;
  expiresAt: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

export type AuthCheckResult =
  | { ok: true }
  | { ok: false; status: 401 | 429; error: string; retryAfterSeconds?: number };

export type WebuiAuthManager = {
  login(token: string, key: string): AuthCheckResult & { sessionId?: string };
  logout(cookieHeader: string | undefined): void;
  validateCookie(cookieHeader: string | undefined, key: string): AuthCheckResult;
  validateRequest(request: IncomingMessage): AuthCheckResult;
  makeSessionCookie(sessionId: string, secure: boolean): string;
  makeLogoutCookie(): string;
  clientKeyFromHeaders(headers: { get(name: string): string | undefined }): string;
  isSecureRequest(headers: { get(name: string): string | undefined }, protocol?: string): boolean;
};

function safeTokenEqual(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }

  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; httpOnly?: boolean; secure?: boolean },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'SameSite=Strict',
    `Max-Age=${options.maxAge}`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function getClientKey(headers: { get(name: string): string | undefined }): string {
  const forwardedFor = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = headers.get('x-real-ip')?.trim();
  return forwardedFor ?? realIp ?? 'unknown';
}

function getRequestKey(request: IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const realIp = request.headers['x-real-ip'];
  const firstRealIp = Array.isArray(realIp) ? realIp[0] : realIp;
  return (
    firstForwarded?.split(',')[0]?.trim() ??
    firstRealIp?.trim() ??
    request.socket.remoteAddress ??
    'unknown'
  );
}

function isSecureRequest(
  headers: { get(name: string): string | undefined },
  protocol?: string,
): boolean {
  if (protocol === 'https:') return true;
  return headers.get('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}

export function createWebuiAuthManager(getAuthToken: () => string | undefined): WebuiAuthManager {
  const sessions = new Map<string, SessionRecord>();
  const failures = new Map<string, RateLimitRecord>();

  function currentFingerprint(): string | null {
    const token = getAuthToken();
    return token ? fingerprintToken(token) : null;
  }

  function isRateLimited(key: string): AuthCheckResult | null {
    const record = failures.get(key);
    const now = Date.now();
    if (!record || record.resetAt <= now) {
      failures.delete(key);
      return null;
    }
    if (record.count < RATE_LIMIT_MAX_FAILURES) return null;
    return {
      ok: false,
      status: 429,
      error: 'Too many authentication failures',
      retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000),
    };
  }

  function recordFailure(key: string): void {
    const now = Date.now();
    const existing = failures.get(key);
    if (!existing || existing.resetAt <= now) {
      failures.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    existing.count += 1;
  }

  function clearFailures(key: string): void {
    failures.delete(key);
  }

  function createSession(token: string): string {
    const sessionId = randomBytes(32).toString('base64url');
    sessions.set(sessionId, {
      tokenFingerprint: fingerprintToken(token),
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
    });
    return sessionId;
  }

  function validateSessionId(
    sessionId: string | undefined,
    key: string,
    options: { countMissingFailure?: boolean } = {},
  ): AuthCheckResult {
    const rateLimit = isRateLimited(key);
    if (rateLimit) return rateLimit;

    const current = currentFingerprint();
    if (!sessionId) {
      if (options.countMissingFailure === true) recordFailure(key);
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    const session = sessions.get(sessionId);
    const now = Date.now();
    if (!current || !session || session.expiresAt <= now || session.tokenFingerprint !== current) {
      if (sessionId) sessions.delete(sessionId);
      recordFailure(key);
      return { ok: false, status: 401, error: 'Unauthorized' };
    }

    clearFailures(key);
    return { ok: true };
  }

  return {
    login(token: string, key: string): AuthCheckResult & { sessionId?: string } {
      const rateLimit = isRateLimited(key);
      if (rateLimit) return rateLimit;

      const expected = getAuthToken();
      if (!expected || !safeTokenEqual(token, expected)) {
        recordFailure(key);
        return { ok: false, status: 401, error: 'Unauthorized' };
      }

      clearFailures(key);
      return { ok: true, sessionId: createSession(token) };
    },

    logout(cookieHeader: string | undefined): void {
      const sessionId = parseCookies(cookieHeader)[SESSION_COOKIE];
      if (sessionId) sessions.delete(sessionId);
    },

    validateCookie(cookieHeader: string | undefined, key: string): AuthCheckResult {
      return validateSessionId(parseCookies(cookieHeader)[SESSION_COOKIE], key);
    },

    validateRequest(request: IncomingMessage): AuthCheckResult {
      return validateSessionId(parseCookies(request.headers.cookie)[SESSION_COOKIE], getRequestKey(request), {
        countMissingFailure: true,
      });
    },

    makeSessionCookie(sessionId: string, secure: boolean): string {
      return serializeCookie(SESSION_COOKIE, sessionId, {
        maxAge: SESSION_MAX_AGE_SECONDS,
        httpOnly: true,
        secure,
      });
    },

    makeLogoutCookie(): string {
      return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true });
    },

    clientKeyFromHeaders: getClientKey,
    isSecureRequest,
  };
}
