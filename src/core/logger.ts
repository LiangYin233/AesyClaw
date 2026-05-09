/**
 * 作用域日志模块。
 *
 * 每个子系统通过 `createScopedLogger(scope)` 创建自己的日志实例。
 * 日志级别由 `config.server.logLevel` 控制，并可在运行时通过 `setLogLevel()` 更新。
 *
 * 禁止直接使用 `console.log/warn/error` —— 始终使用带作用域的日志器。
 */

import { inspect } from 'node:util';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 单条日志条目，包含格式化输出和元数据 */
export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  details: string | null;
  formatted: string;
};

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

type LogSubscriber = (entry: LogEntry) => void;

const logSubscribers = new Set<LogSubscriber>();

/**
 * 设置全局日志级别。在配置加载或热重载时调用。
 */
export function setLogLevel(level: string): void {
  if (level in LOG_LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function supportsAnsiColor(stream: NodeJS.WriteStream): boolean {
  const forceColor = process.env['FORCE_COLOR'];

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

  return process.env['TERM'] !== 'dumb';
}

function colorize(text: string, level: LogLevel, enabled: boolean): string {
  if (!enabled) {
    return text;
  }

  return `${LOG_COLORS[level]}${text}${ANSI_RESET}`;
}

function formatTimestamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatMessage(scope: string, level: LogLevel, message: string): string {
  const timestamp = formatTimestamp(new Date());
  const useColor = supportsAnsiColor(
    level === 'warn' || level === 'error' ? process.stderr : process.stdout,
  );
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

function appendRecentLogEntry(
  scope: string,
  level: LogLevel,
  message: string,
  args: readonly unknown[],
): void {
  const timestamp = formatTimestamp(new Date());
  const details = formatLogDetails(args);
  const formatted = details
    ? `${formatMessageWithTimestamp(timestamp, scope, level, message, false)} ${details}`
    : formatMessageWithTimestamp(timestamp, scope, level, message, false);

  const entry: LogEntry = {
    id: nextLogEntryId++,
    timestamp,
    level,
    scope,
    message,
    details,
    formatted,
  };

  recentLogBuffer.push(entry);

  if (recentLogBuffer.length > MAX_LOG_BUFFER_SIZE) {
    recentLogBuffer.splice(0, recentLogBuffer.length - MAX_LOG_BUFFER_SIZE);
  }

  for (const subscriber of logSubscribers) {
    subscriber(entry);
  }
}

function log(
  scope: string,
  level: LogLevel,
  consoleMethod: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  args: readonly unknown[],
): void {
  if (!(LOG_LEVELS[level] >= LOG_LEVELS[currentLevel])) {
    return;
  }

  appendRecentLogEntry(scope, level, message, args);
  globalThis.console[consoleMethod](formatMessage(scope, level, message), ...args);
}

/**
 * 获取最近 N 条日志条目。
 *
 * @param limit - 返回数量上限（默认 200，最大 500）
 * @returns 最近的日志条目数组
 */
export function getRecentLogEntries(limit = 200): LogEntry[] {
  const normalizedLimit = Math.max(1, Math.min(limit, MAX_LOG_BUFFER_SIZE));
  return recentLogBuffer.slice(-normalizedLimit);
}

/**
 * 订阅实时日志条目通知。
 *
 * @param subscriber - 每次写入日志时调用的回调
 * @returns 取消订阅的函数
 */
export function subscribeToLogEntries(subscriber: LogSubscriber): () => void {
  logSubscribers.add(subscriber);
  return () => {
    logSubscribers.delete(subscriber);
  };
}

/** 清空日志缓冲区（仅限测试环境调用） */
export function clearRecentLogEntriesForTests(): void {
  if (process.env['VITEST'] === undefined) {
    throw new Error('clearRecentLogEntriesForTests 仅可在测试环境中使用');
  }
  recentLogBuffer.length = 0;
  nextLogEntryId = 1;
  logSubscribers.clear();
}

/** 作用域日志器接口 — 提供 debug/info/warn/error 四级日志方法 */
export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

/**
 * 创建一个带作用域的日志实例。
 *
 * @param scope - 遵循 `category:name` 约定的模块标识符
 *   （如 'config'、'db'、'plugin:myfeature'、'channel:onebot'）
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
