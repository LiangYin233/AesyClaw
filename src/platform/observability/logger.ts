import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

export interface ScopedLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

const LOG_LEVELS = ['info', 'warn', 'error', 'debug'] as const;

export function createScopedLogger(scope: string, scopeKey: string = 'scope'): ScopedLogger {
  const make = (level: (typeof LOG_LEVELS)[number]) =>
    (msg: string, data?: Record<string, unknown>) =>
      logger[level]({ [scopeKey]: scope, ...data }, `[${scope}] ${msg}`);
  return {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  };
}
