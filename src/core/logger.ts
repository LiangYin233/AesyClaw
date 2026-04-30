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

import { inspect } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  details: string | null;
  formatted: string;
}

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
let nextLogEntryId = 1;

const MAX_LOG_BUFFER_SIZE = 500;
const recentLogBuffer: LogEntry[] = [];

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
  return formatMessageWithTimestamp(timestamp, scope, level, message, useColor);
}

function formatMessageWithTimestamp(
  timestamp: string,
  scope: string,
  level: LogLevel,
  message: string,
  useColor: boolean,
): string {
  const formattedLevel = colorize(`[${level.toUpperCase()}]`, level, useColor);
  const formattedScope = colorize(`[${scope}]`, level, useColor);

  return `${timestamp} ${formattedLevel} ${formattedScope} ${message}`;
}

function formatLogDetails(args: readonly unknown[]): string | null {
  if (args.length === 0) {
    return null;
  }

  return args
    .map((arg) => inspect(arg, { colors: false, depth: 4, breakLength: Infinity }))
    .join(' ');
}

function appendRecentLogEntry(scope: string, level: LogLevel, message: string, args: readonly unknown[]): void {
  const timestamp = formatTimestamp(new Date());
  const details = formatLogDetails(args);
  const formatted = details
    ? `${formatMessageWithTimestamp(timestamp, scope, level, message, false)} ${details}`
    : formatMessageWithTimestamp(timestamp, scope, level, message, false);

  recentLogBuffer.push({
    id: nextLogEntryId++,
    timestamp,
    level,
    scope,
    message,
    details,
    formatted,
  });

  if (recentLogBuffer.length > MAX_LOG_BUFFER_SIZE) {
    recentLogBuffer.splice(0, recentLogBuffer.length - MAX_LOG_BUFFER_SIZE);
  }
}

function log(scope: string, level: LogLevel, consoleMethod: 'debug' | 'info' | 'warn' | 'error', message: string, args: readonly unknown[]): void {
  if (!shouldLog(level)) {
    return;
  }

  appendRecentLogEntry(scope, level, message, args);
  console[consoleMethod](formatMessage(scope, level, message), ...args);
}

export function getRecentLogEntries(limit = 200): LogEntry[] {
  const normalizedLimit = Math.max(1, Math.min(limit, MAX_LOG_BUFFER_SIZE));
  return recentLogBuffer.slice(-normalizedLimit);
}

export function clearRecentLogEntriesForTests(): void {
  recentLogBuffer.length = 0;
  nextLogEntryId = 1;
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
      log(scope, 'debug', 'debug', message, args);
    },
    info(message: string, ...args: unknown[]): void {
      log(scope, 'info', 'info', message, args);
    },
    warn(message: string, ...args: unknown[]): void {
      log(scope, 'warn', 'warn', message, args);
    },
    error(message: string, ...args: unknown[]): void {
      log(scope, 'error', 'error', message, args);
    },
  };
}
