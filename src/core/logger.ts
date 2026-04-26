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

const ANSI_RESET = '\x1b[0m';

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

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

function supportsAnsiColor(stream: NodeJS.WriteStream): boolean {
  const forceColor = process.env.FORCE_COLOR;

  if ('NO_COLOR' in process.env) {
    return false;
  }

  if (forceColor === '0' || forceColor === 'false') {
    return false;
  }

  if (forceColor && forceColor !== '') {
    return true;
  }

  if (!stream.isTTY) {
    return false;
  }

  return process.env.TERM !== 'dumb';
}

function getLogStream(level: LogLevel): NodeJS.WriteStream {
  return level === 'warn' || level === 'error' ? process.stderr : process.stdout;
}

function colorize(text: string, level: LogLevel, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  return `${LOG_COLORS[level]}${text}${ANSI_RESET}`;
}

function formatTimestamp(date: Date): string {
  return date.toISOString().slice(5, 19).replace('T', ' ');
}

function formatMessage(scope: string, level: LogLevel, message: string): string {
  const timestamp = formatTimestamp(new Date());
  const useColor = supportsAnsiColor(getLogStream(level));
  const formattedLevel = colorize(`[${level.toUpperCase()}]`, level, useColor);
  const formattedScope = colorize(`[${scope}]`, level, useColor);

  return `${timestamp} ${formattedLevel} ${formattedScope} ${message}`;
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
