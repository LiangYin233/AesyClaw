import { normalizeError } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  prefix: string;
  message: string;
  context?: string;
  line: string;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const PREFIXES: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

const PREFIX_COLORS: Record<LogLevel, string> = {
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red
};

const DEFAULT_PREVIEW_LIMIT = 120;
const DEFAULT_LOG_BUFFER_SIZE = 1000;
const SENSITIVE_KEY_PATTERN = /(authorization|token|api[-_]?key|secret|password|cookie)/i;

let logSequence = 0;

class LogBuffer {
  private entries: LogEntry[] = [];

  constructor(private limit: number = DEFAULT_LOG_BUFFER_SIZE) {}

  add(entry: Omit<LogEntry, 'id'>): void {
    this.entries.push({
      ...entry,
      id: `${Date.now()}-${++logSequence}`
    });

    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(-this.limit);
    }
  }

  list(options: { level?: LogLevel; limit?: number } = {}): LogEntry[] {
    const { level, limit = 200 } = options;
    const filtered = level
      ? this.entries.filter((entry) => entry.level === level)
      : this.entries;

    return filtered.slice(-limit).reverse();
  }

  size(): number {
    return this.entries.length;
  }
}

interface LoggerState {
  level: LogLevel;
  buffer: LogBuffer;
}

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error) && !(value instanceof Date);
}

function maybeRedactKey(key?: string): boolean {
  return !!key && SENSITIVE_KEY_PATTERN.test(key);
}

function maybeRedactString(value: string): string {
  const strippedQuery = value.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?...');
  return strippedQuery.replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]');
}

function previewText(value: string, limit: number = DEFAULT_PREVIEW_LIMIT): string {
  const compact = collapseWhitespace(maybeRedactString(value));
  if (compact.length <= limit) {
    return compact;
  }
  return `${compact.slice(0, limit - 1)}…`;
}

function formatValue(value: unknown, key?: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (maybeRedactKey(key)) {
    return '[redacted]';
  }

  if (value instanceof Error) {
    return previewText(normalizeError(value));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string') {
    const normalized = previewText(value);
    return normalized ? JSON.stringify(normalized) : '""';
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, 6)
      .map((item) => formatValue(item))
      .filter((item): item is string => !!item);
    const suffix = value.length > 6 ? ',…' : '';
    return `[${items.join(',')}${suffix}]`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .slice(0, 8)
      .map(([entryKey, entryValue]) => {
        const formatted = formatValue(entryValue, entryKey);
        return formatted ? `${entryKey}:${formatted}` : undefined;
      })
      .filter((item): item is string => !!item);

    const suffix = Object.keys(value).length > 8 ? ',…' : '';
    return `{${entries.join(',')}${suffix}}`;
  }

  return previewText(String(value));
}

function formatContext(context: LogContext): string {
  const entries = Object.entries(context)
    .map(([key, value]) => {
      const formatted = formatValue(value, key);
      return formatted === undefined ? undefined : `${key}=${formatted}`;
    })
    .filter((item): item is string => !!item);

  return entries.join(' ');
}

function formatBaseParts(prefix: string, level: LogLevel, message: string, timestamp: Date): string[] {
  const timeText = timestamp.toISOString().slice(11, 23);
  const prefixLabel = prefix ? prefix.padEnd(18).slice(0, 18) : ''.padEnd(18);
  return [timeText, prefixLabel, PREFIXES[level], message];
}

function parseLogArgs(args: unknown[]): { context?: LogContext; extras: unknown[] } {
  if (args.length === 0) {
    return { extras: [] };
  }

  const [first, ...rest] = args;
  if (isPlainObject(first)) {
    return { context: first, extras: rest };
  }

  if (first instanceof Error) {
    return { context: { error: normalizeError(first) }, extras: rest };
  }

  return {
    context: { detail: first },
    extras: rest
  };
}

export class Logger {
  private state: LoggerState;
  private prefix: string;

  constructor(options: LoggerOptions = {}, state?: LoggerState) {
    this.state = state || {
      level: options.level || 'info',
      buffer: new LogBuffer()
    };
    this.prefix = options.prefix || '';
  }

  setLevel(level: LogLevel): void {
    this.state.level = level;
  }

  getLevel(): LogLevel {
    return this.state.level;
  }

  getConfig(): { level: LogLevel; prefix: string } {
    return {
      level: this.state.level,
      prefix: this.prefix
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.state.level];
  }

  preview(value: unknown, limit: number = DEFAULT_PREVIEW_LIMIT): string {
    if (value === undefined || value === null) {
      return '';
    }
    return previewText(typeof value === 'string' ? value : String(value), limit);
  }

  private format(level: LogLevel, message: string, context?: LogContext, timestamp: Date = new Date()): string {
    const color = PREFIX_COLORS[level];
    const [timeText, prefixLabel, levelText, messageText] = formatBaseParts(this.prefix, level, message, timestamp);
    const base = [
      `${COLORS.gray}${timeText}${COLORS.reset}`,
      `${COLORS.gray}${prefixLabel}${COLORS.reset}`,
      `${color}${levelText}${COLORS.reset}`,
      messageText
    ].join(' ');

    if (!context || Object.keys(context).length === 0) {
      return base;
    }

    const serialized = formatContext(context);
    return serialized ? `${base} | ${serialized}` : base;
  }

  private formatPlain(level: LogLevel, message: string, context?: LogContext, timestamp: Date = new Date()): string {
    const base = formatBaseParts(this.prefix, level, message, timestamp).join(' ');

    if (!context || Object.keys(context).length === 0) {
      return base;
    }

    const serialized = formatContext(context);
    return serialized ? `${base} | ${serialized}` : base;
  }

  private recordEntry(level: LogLevel, message: string, context: LogContext | undefined, timestamp: Date): void {
    const contextText = context && Object.keys(context).length > 0 ? formatContext(context) : undefined;
    this.state.buffer.add({
      timestamp: timestamp.toISOString(),
      level,
      prefix: this.prefix,
      message,
      context: contextText,
      line: this.formatPlain(level, message, context, timestamp)
    });
  }

  private write(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const timestamp = new Date();
    const { context, extras } = parseLogArgs(args);
    const line = this.format(level, message, context, timestamp);

    this.recordEntry(level, message, context, timestamp);

    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }

    if (extras.length > 0 && this.isLevelEnabled('debug')) {
      const extraContext = extras.reduce<LogContext>((acc, extra, index) => {
        acc[`extra${index + 1}`] = extra;
        return acc;
      }, {});
      const extraTimestamp = new Date();
      const extraLine = this.format('debug', `${message} (extra)`, extraContext, extraTimestamp);
      this.recordEntry('debug', `${message} (extra)`, extraContext, extraTimestamp);
      console.log(extraLine);
    }
  }

  getEntries(options: { level?: LogLevel; limit?: number } = {}): LogEntry[] {
    return this.state.buffer.list(options);
  }

  getBufferSize(): number {
    return this.state.buffer.size();
  }

  debug(message: string, ...args: unknown[]): void {
    this.write('debug', message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.write('info', message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.write('warn', message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.write('error', message, ...args);
  }

  child(options: LoggerOptions): Logger {
    return new Logger({
      prefix: options.prefix || this.prefix
    }, this.state);
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

export const logger = new Logger();

export {
  normalizeError,
  createErrorResponse,
  createValidationErrorResponse,
  AppError,
  ValidationError,
  NotFoundError,
  isRetryableError
} from './errors.js';
