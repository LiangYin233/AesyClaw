/**
 * 作用域日志模块。
 *
 * 每个子系统通过 `createScopedLogger(scope)` 创建自己的日志实例。
 * 日志级别由 `config.agent.logLevel` 控制，并可在运行时通过 `setLogLevel()` 更新。
 *
 * 禁止直接使用 `console.log/warn/error` —— 始终使用带作用域的日志器。
 */

import { inspect } from 'node:util';

/** 日志级别 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** 单条日志条目 — 不含格式化文本，供消费者自行拼装 */
export type LogEntry = {
  id: number;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  details: string | null;
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
const DEFAULT_LOG_ENTRIES_LIMIT = 200;
const recentLogBuffer: LogEntry[] = [];
const logSubscribers = new Set<(entry: LogEntry) => void>();

const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_CYAN = '\x1b[36m';
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[34m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

/** 设置全局日志级别 */
export function setLogLevel(level: string): void {
  if (level in LOG_LEVELS) {
    currentLevel = level as LogLevel;
  }
}

function formatTimestamp(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/** 格式化终端输出行，交互式终端下带 ANSI 颜色。 */
function formatConsoleLine(
  scope: string,
  level: LogLevel,
  message: string,
  consoleMethod: 'debug' | 'info' | 'warn' | 'error',
): string {
  const timestamp = formatTimestamp(new Date());
  const levelTag = `[${level.toUpperCase()}]`;
  const scopeTag = `[${scope}]`;
  if (!shouldColorize(consoleMethod)) {
    return `${timestamp} ${levelTag} ${scopeTag} ${message}`;
  }

  return `${colorize(timestamp, ANSI_DIM)} ${colorize(levelTag, LEVEL_COLORS[level])} ${colorize(scopeTag, ANSI_CYAN)} ${message}`;
}

function colorize(value: string, color: string): string {
  return `${color}${value}${ANSI_RESET}`;
}

function shouldColorize(consoleMethod: 'debug' | 'info' | 'warn' | 'error'): boolean {
  if ('NO_COLOR' in process.env) return false;
  const forceColor = process.env['FORCE_COLOR'];
  if (forceColor && forceColor !== '0') return true;
  if (process.env['TERM'] === 'dumb') return false;

  const stream =
    consoleMethod === 'warn' || consoleMethod === 'error' ? process.stderr : process.stdout;
  return stream.isTTY === true;
}

function formatLogDetails(args: readonly unknown[]): string | null {
  if (args.length === 0) return null;
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
  const entry: LogEntry = {
    id: nextLogEntryId++,
    timestamp: formatTimestamp(new Date()),
    level,
    scope,
    message,
    details: formatLogDetails(args),
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
  if (!(LOG_LEVELS[level] >= LOG_LEVELS[currentLevel])) return;

  appendRecentLogEntry(scope, level, message, args);
  globalThis.console[consoleMethod](
    formatConsoleLine(scope, level, message, consoleMethod),
    ...args,
  );
}

/** 获取最近 N 条日志条目 */
export function getRecentLogEntries(limit = DEFAULT_LOG_ENTRIES_LIMIT): LogEntry[] {
  const normalizedLimit = Math.max(1, Math.min(limit, MAX_LOG_BUFFER_SIZE));
  return recentLogBuffer.slice(-normalizedLimit);
}

/** 订阅实时日志条目通知。返回取消订阅的函数。 */
export function subscribeToLogEntries(subscriber: (entry: LogEntry) => void): () => void {
  logSubscribers.add(subscriber);
  return () => {
    logSubscribers.delete(subscriber);
  };
}

/** 重置日志内部状态（测试用） */
export function resetLogState(): void {
  recentLogBuffer.length = 0;
  nextLogEntryId = 1;
  logSubscribers.clear();
}

/** 作用域日志器接口 */
export type Logger = {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

/** 创建一个带作用域的日志实例 */
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
