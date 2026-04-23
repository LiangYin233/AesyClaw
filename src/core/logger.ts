/**
 * Scoped logger module.
 *
 * Each subsystem creates its own logger instance via `createScopedLogger(scope)`.
 * The log level is controlled by `config.server.logLevel` and can be updated
 * at runtime through `setLogLevel()`.
 *
 * NEVER use `console.log/warn/error` directly — always use a scoped logger.
 * The only exception is `index.ts` before the logger is initialised.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

/**
 * Set the global log level. Called when config is loaded or hot-reloaded.
 */
export function setLogLevel(level: string): void {
  if (level in LOG_LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(scope: string, level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase()}] [${scope}] ${message}`;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Create a scoped logger instance.
 *
 * @param scope - Module identifier following the `category:name` convention
 *   (e.g. 'config', 'db', 'plugin:myfeature', 'channel:onebot')
 */
export function createScopedLogger(scope: string): Logger {
  return {
    debug(message: string, ...args: unknown[]): void {
      if (shouldLog('debug')) {
        console.debug(formatMessage(scope, 'debug', message), ...args);
      }
    },
    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        console.info(formatMessage(scope, 'info', message), ...args);
      }
    },
    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        console.warn(formatMessage(scope, 'warn', message), ...args);
      }
    },
    error(message: string, ...args: unknown[]): void {
      if (shouldLog('error')) {
        console.error(formatMessage(scope, 'error', message), ...args);
      }
    },
  };
}