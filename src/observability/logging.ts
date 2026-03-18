export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFieldValue = string | number | boolean | null;
export type LogFields = Record<string, unknown>;

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, LogFieldValue>;
}

export interface LoggingConfig {
  level: LogLevel;
  bufferSize: number;
}

export interface Logger {
  child(scope: string): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  red: '\x1b[31m'
} as const;

function shouldUseColor(): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  return !!process.stdout?.isTTY;
}

function colorize(text: string, color: string): string {
  return `${color}${text}${ANSI.reset}`;
}

function levelColor(level: LogLevel): string {
  switch (level) {
    case 'debug':
      return ANSI.cyan;
    case 'info':
      return ANSI.blue;
    case 'warn':
      return ANSI.yellow;
    case 'error':
      return ANSI.red;
  }
}

const DEFAULT_PREVIEW_LIMIT = 120;

function normalizeSensitiveKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalizeSensitiveKey(key);
  return normalized === 'authorization'
    || normalized === 'token'
    || normalized === 'accesstoken'
    || normalized === 'refreshtoken'
    || normalized === 'sessiontoken'
    || normalized === 'bearertoken'
    || normalized === 'apikey'
    || normalized === 'clientsecret'
    || normalized === 'secret'
    || normalized === 'password'
    || normalized === 'cookie'
    || normalized === 'setcookie';
}

function padNumber(value: number, size: number = 2): string {
  return String(value).padStart(size, '0');
}

function formatTimezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absoluteMinutes / 60);
  const minutes = absoluteMinutes % 60;
  return `${sign}${padNumber(hours)}:${padNumber(minutes)}`;
}

export function formatLocalTimestamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}T${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}.${padNumber(date.getMilliseconds(), 3)}${formatTimezoneOffset(date)}`;
}

export function formatLocalDateTime(date: Date = new Date()): string {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())} ${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
}

export function formatLocalClock(date: Date = new Date()): string {
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}`;
}

export function getCurrentTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
}

function formatLocalTime(date: Date): string {
  return `${padNumber(date.getHours())}:${padNumber(date.getMinutes())}:${padNumber(date.getSeconds())}.${padNumber(date.getMilliseconds(), 3)}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function redactString(value: string): string {
  const strippedQuery = value.replace(/(https?:\/\/[^\s?]+)\?[^\s]+/g, '$1?...');
  return strippedQuery.replace(/\b(Bearer\s+)[^\s]+/gi, '$1[redacted]');
}

export function preview(value: unknown, limit: number = DEFAULT_PREVIEW_LIMIT): string {
  if (value === undefined || value === null) {
    return '';
  }

  const compact = collapseWhitespace(redactString(typeof value === 'string' ? value : String(value)));
  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, Math.max(limit - 1, 1))}…`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error) && !(value instanceof Date);
}

function serializeFieldValue(value: unknown, key?: string): LogFieldValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (key && isSensitiveKey(key)) {
    return '[redacted]';
  }
  if (value instanceof Date) {
    return formatLocalTimestamp(value);
  }
  if (value instanceof Error) {
    return preview(value.message);
  }
  if (typeof value === 'string') {
    return preview(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return preview(JSON.stringify(value.slice(0, 8)));
  }
  if (isPlainObject(value)) {
    const normalized: Record<string, LogFieldValue> = {};
    for (const [nestedKey, nestedValue] of Object.entries(value).slice(0, 8)) {
      const serialized = serializeFieldValue(nestedValue, nestedKey);
      if (serialized !== undefined) {
        normalized[nestedKey] = serialized;
      }
    }
    return preview(JSON.stringify(normalized));
  }
  return preview(String(value));
}

function formatFields(fields?: Record<string, LogFieldValue>): string {
  if (!fields || Object.keys(fields).length === 0) {
    return '';
  }

  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : String(value)}`)
    .join(' ');
}

function formatScopeSegment(scope: string): string {
  if (!scope) {
    return '';
  }

  const normalized = normalizeScope(scope);
  return `[${normalized}]`;
}

function normalizeScope(scope: string): string {
  const segments = scope.split('/').filter(Boolean);
  if (segments.length < 2) {
    return scope;
  }

  const last = segments[segments.length - 1];
  const previous = segments[segments.length - 2];
  if (previous.startsWith('plugin_') && previous.slice('plugin_'.length) === last) {
    return segments.slice(0, -1).join('/');
  }

  return scope;
}

class LogBuffer {
  private entries: LogEntry[] = [];
  private sequence = 0;

  constructor(private limit: number) {}

  setLimit(limit: number): void {
    this.limit = limit;
    if (this.entries.length > limit) {
      this.entries = this.entries.slice(-limit);
    }
  }

  add(entry: Omit<LogEntry, 'id'>): void {
    this.entries.push({
      ...entry,
      id: `${Date.now()}-${++this.sequence}`
    });
    if (this.entries.length > this.limit) {
      this.entries = this.entries.slice(-this.limit);
    }
  }

  list(options: { level?: LogLevel; limit?: number } = {}): LogEntry[] {
    const filtered = options.level
      ? this.entries.filter((entry) => entry.level === options.level)
      : this.entries;
    return filtered.slice(-(options.limit ?? 200)).reverse();
  }

  size(): number {
    return this.entries.length;
  }
}

class LoggingService {
  private config: LoggingConfig = {
    level: 'info',
    bufferSize: 1000
  };
  private buffer = new LogBuffer(this.config.bufferSize);

  readonly root: Logger = new ScopedLogger(this, '');

  configure(partial: Partial<LoggingConfig>): void {
    this.config = {
      ...this.config,
      ...partial
    };
    this.buffer.setLimit(this.config.bufferSize);
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
  }

  getLevel(): LogLevel {
    return this.config.level;
  }

  getConfig(): LoggingConfig {
    return { ...this.config };
  }

  getEntries(options: { level?: LogLevel; limit?: number } = {}): LogEntry[] {
    return this.buffer.list(options);
  }

  getBufferSize(): number {
    return this.buffer.size();
  }

  write(level: LogLevel, scope: string, message: string, rawFields?: unknown): void {
    if (LEVELS[level] < LEVELS[this.config.level]) {
      return;
    }

    const fields = this.normalizeFields(rawFields);
    const timestamp = new Date();
    const line = this.formatLine({ level, scope, message, fields, timestamp });

    this.buffer.add({
      timestamp: formatLocalTimestamp(timestamp),
      level,
      scope,
      message,
      fields
    });

    if (level === 'error') {
      console.error(line);
      return;
    }
    if (level === 'warn') {
      console.warn(line);
      return;
    }
    console.log(line);
  }

  private normalizeFields(rawFields?: unknown): Record<string, LogFieldValue> | undefined {
    if (rawFields === undefined) {
      return undefined;
    }

    if (!isPlainObject(rawFields)) {
      const detail = serializeFieldValue(rawFields, 'detail');
      return detail === undefined ? undefined : { detail };
    }

    const fields: Record<string, LogFieldValue> = {};
    for (const [key, value] of Object.entries(rawFields)) {
      const serialized = serializeFieldValue(value, key);
      if (serialized !== undefined) {
        fields[key] = serialized;
      }
    }

    return Object.keys(fields).length > 0 ? fields : undefined;
  }

  private formatLine(entry: {
    level: LogLevel;
    scope: string;
    message: string;
    fields?: Record<string, LogFieldValue>;
    timestamp: Date;
  }): string {
    const time = formatLocalTime(entry.timestamp);
    const scope = formatScopeSegment(entry.scope);
    const fields = formatFields(entry.fields);
    const useColor = shouldUseColor();
    const renderedTime = useColor ? colorize(time, ANSI.dim) : time;
    const renderedLevel = useColor
      ? colorize(entry.level.toUpperCase().padEnd(5), levelColor(entry.level))
      : entry.level.toUpperCase().padEnd(5);
    const renderedScope = scope
      ? (useColor ? colorize(scope, ANSI.dim) : scope)
      : '';
    const renderedFields = useColor && fields ? colorize(fields, ANSI.dim) : fields;
    const scopePart = renderedScope ? ` ${renderedScope}` : '';

    return renderedFields
      ? `${renderedTime} ${renderedLevel}${scopePart} ${entry.message} | ${renderedFields}`
      : `${renderedTime} ${renderedLevel}${scopePart} ${entry.message}`;
  }
}

class ScopedLogger implements Logger {
  constructor(
    private service: LoggingService,
    private scope: string
  ) {}

  child(scope: string): Logger {
    return new ScopedLogger(this.service, this.scope ? `${this.scope}/${scope}` : scope);
  }

  debug(message: string, fields?: LogFields): void {
    this.service.write('debug', this.scope, message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.service.write('info', this.scope, message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.service.write('warn', this.scope, message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.service.write('error', this.scope, message, fields);
  }
}

export const logging = new LoggingService();
export const logger = logging.root;
