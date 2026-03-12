import { normalizeError } from './errors.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

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
const SENSITIVE_KEY_PATTERN = /(authorization|token|api[-_]?key|secret|password|cookie)/i;

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
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info';
    this.prefix = options.prefix || '';
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  getConfig(): { level: LogLevel; prefix: string } {
    return {
      level: this.level,
      prefix: this.prefix
    };
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  preview(value: unknown, limit: number = DEFAULT_PREVIEW_LIMIT): string {
    if (value === undefined || value === null) {
      return '';
    }
    return previewText(typeof value === 'string' ? value : String(value), limit);
  }

  private format(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString().slice(11, 23);
    const color = PREFIX_COLORS[level];
    const prefixLabel = this.prefix ? this.prefix.padEnd(18).slice(0, 18) : ''.padEnd(18);
    const base = [
      `${COLORS.gray}${timestamp}${COLORS.reset}`,
      `${COLORS.gray}${prefixLabel}${COLORS.reset}`,
      `${color}${PREFIXES[level]}${COLORS.reset}`,
      message
    ].join(' ');

    if (!context || Object.keys(context).length === 0) {
      return base;
    }

    const serialized = formatContext(context);
    return serialized ? `${base} | ${serialized}` : base;
  }

  private write(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const { context, extras } = parseLogArgs(args);
    const line = this.format(level, message, context);

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
      console.log(this.format('debug', `${message} (extra)`, extraContext));
    }
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
      level: this.level,
      prefix: options.prefix || this.prefix
    });
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
