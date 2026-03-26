import pino, { type DestinationStream, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import pretty from 'pino-pretty';
import { execFileSync } from 'child_process';

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
  pretty: boolean;
}

export interface Logger {
  child(scope: string): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggingServiceOptions {
  destination?: DestinationStream;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const DEFAULT_PREVIEW_LIMIT = 120;
const ANSI_RESET_FOREGROUND = '\u001B[39m';

let windowsConsoleUtf8Initialized = false;

function initializeWindowsConsoleUtf8(): void {
  if (windowsConsoleUtf8Initialized || process.platform !== 'win32') {
    return;
  }
  windowsConsoleUtf8Initialized = true;

  try {
    process.stdout?.setDefaultEncoding?.('utf8');
    process.stderr?.setDefaultEncoding?.('utf8');
  } catch {
    // Ignore stream encoding failures and continue with the code-page fallback.
  }

  try {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    execFileSync(comspec, ['/d', '/s', '/c', 'chcp 65001>nul'], {
      stdio: 'ignore',
      windowsHide: true
    });
  } catch {
    // Best effort only. Some restricted environments block spawning cmd.exe.
  }
}

function shouldColorizePrettyOutput(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }

  const stdout = process.stdout;
  if (!stdout || !stdout.isTTY) {
    return false;
  }

  if (typeof stdout.hasColors === 'function') {
    try {
      return stdout.hasColors();
    } catch {
      return false;
    }
  }

  return process.env.TERM !== 'dumb';
}

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

  return `${compact.slice(0, Math.max(limit - 1, 1))}...`;
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

function formatInlineFieldValue(value: unknown): string {
  if (value === undefined || value === null) {
    return String(value);
  }

  if (typeof value === 'string') {
    return value.includes(' ') ? JSON.stringify(value) : value;
  }

  return String(value);
}

function formatInlineFields(fields?: Record<string, LogFieldValue>): string {
  if (!fields) {
    return '';
  }

  const entries = Object.entries(fields)
    .filter(([key]) => key !== 'request_id')
    .slice(0, 8)
    .map(([key, value]) => `${key}=${formatInlineFieldValue(value)}`);

  return entries.length > 0 ? entries.join(' ') : '';
}

function formatConsoleMessage(
  level: LogLevel,
  colorize: boolean,
  scope: string,
  requestId: string | undefined,
  message: string,
  fields?: Record<string, LogFieldValue>
): string {
  const scopeLabel = scope && scope !== 'root' ? `[${scope}]` : '';
  const requestLabel = requestId ? `[req:${requestId}]` : '';
  const fieldsLabel = formatInlineFields(fields);

  const baseMessage = [scopeLabel, requestLabel, message, fieldsLabel]
    .filter(Boolean)
    .join(' ');

  if (colorize && level === 'info') {
    return `${ANSI_RESET_FOREGROUND}${baseMessage}`;
  }

  return baseMessage;
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

export class LoggingService {
  private config: LoggingConfig = {
    level: 'info',
    bufferSize: 1000,
    pretty: true
  };
  private buffer = new LogBuffer(this.config.bufferSize);
  private defaultPrettyEmitter?: PinoLogger;
  private defaultJsonEmitter?: PinoLogger;
  private customEmitter?: PinoLogger;

  readonly root: Logger;

  constructor(private readonly options: LoggingServiceOptions = {}) {
    initializeWindowsConsoleUtf8();
    this.root = new ScopedLogger(this, '');
  }

  configure(partial: Partial<LoggingConfig>): void {
    this.config = {
      ...this.config,
      ...partial
    };
    this.buffer.setLimit(this.config.bufferSize);
    this.syncEmitterLevels();
  }

  setLevel(level: LogLevel): void {
    this.config.level = level;
    this.syncEmitterLevels();
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
    const normalizedScope = normalizeScope(scope);
    const requestId = typeof fields?.request_id === 'string' ? fields.request_id : undefined;

    this.buffer.add({
      timestamp: formatLocalTimestamp(timestamp),
      level,
      scope,
      message,
      fields
    });

    const payload: Record<string, unknown> = {
      scope: normalizedScope || 'root'
    };

    if (requestId) {
      payload.request_id = requestId;
    }
    if (fields && Object.keys(fields).length > 0) {
      payload.fields = fields;
    }

    if (this.config.pretty && !this.options.destination) {
      this.getEmitter()[level](formatConsoleMessage(
        level,
        shouldColorizePrettyOutput(),
        payload.scope as string,
        requestId,
        message,
        fields
      ));
      return;
    }

    this.getEmitter()[level](payload, message);
  }

  private syncEmitterLevels(): void {
    if (this.customEmitter) {
      this.customEmitter.level = this.config.level;
    }
    if (this.defaultPrettyEmitter) {
      this.defaultPrettyEmitter.level = this.config.level;
    }
    if (this.defaultJsonEmitter) {
      this.defaultJsonEmitter.level = this.config.level;
    }
  }

  private getEmitter(): PinoLogger {
    if (this.options.destination) {
      if (!this.customEmitter) {
        this.customEmitter = this.createEmitter(this.options.destination);
      }
      return this.customEmitter;
    }

    if (this.config.pretty) {
      if (!this.defaultPrettyEmitter) {
        this.defaultPrettyEmitter = this.createEmitter(pretty({
          colorize: shouldColorizePrettyOutput(),
          crlf: process.platform === 'win32',
          destination: process.stdout,
          ignore: 'pid,hostname',
          messageKey: 'message',
          sync: true
        }) as DestinationStream);
      }
      return this.defaultPrettyEmitter;
    }

    if (!this.defaultJsonEmitter) {
      this.defaultJsonEmitter = this.createEmitter(process.stdout);
    }
    return this.defaultJsonEmitter;
  }

  private createEmitter(destination: DestinationStream): PinoLogger {
    const options: LoggerOptions = {
      level: this.config.level,
      base: undefined,
      messageKey: 'message',
      errorKey: 'error',
      formatters: {
        level: (label) => ({ level: label })
      },
      timestamp: () => `,"time":"${formatLocalTimestamp()}"`
    };

    return pino(options, destination);
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
