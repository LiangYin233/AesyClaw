import type { DestinationStream } from 'pino';
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
  withFields(fields: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggingServiceOptions {
  destination?: DestinationStream;
  colorize?: boolean;
}

interface NormalizedLogEvent {
  timestamp: Date;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: Record<string, LogFieldValue>;
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR'
};
const ANSI_RESET = '\u001b[0m';
const ANSI_DIM = '\u001b[2m';
const ANSI_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\u001b[36m',
  info: '\u001b[32m',
  warn: '\u001b[33m',
  error: '\u001b[31m'
};

const SUPPRESSED_SCOPE_PREFIXES = ['API', 'HTTP', 'ObservabilityAPI'];
const DEFAULT_PREVIEW_LIMIT = 120;
const DEFAULT_STACK_PREVIEW_LIMIT = 240;
const CORRELATION_FIELD_ORDER = [
  'sessionKey',
  'channel',
  'chatId',
  'taskId',
  'agentName',
  'toolName',
  'provider',
  'model',
  'serverName'
] as const;

const CORRELATION_FIELD_LABELS: Record<(typeof CORRELATION_FIELD_ORDER)[number], string> = {
  sessionKey: 'session',
  channel: 'channel',
  chatId: 'chat',
  taskId: 'task',
  agentName: 'agent',
  toolName: 'tool',
  provider: 'provider',
  model: 'model',
  serverName: 'server'
};

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

function shouldColorizePrettyOutput(force?: boolean): boolean {
  if (force !== undefined) {
    return force;
  }

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

function formatCompactClock(date: Date): string {
  return `${formatLocalClock(date)}.${padNumber(date.getMilliseconds(), 3)}`;
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
    return scope || 'root';
  }

  const last = segments[segments.length - 1];
  const previous = segments[segments.length - 2];
  if (previous.startsWith('plugin_') && previous.slice('plugin_'.length) === last) {
    return segments.slice(0, -1).join('/');
  }

  return scope;
}

function formatInlineFieldValue(value: LogFieldValue): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return value.includes(' ') ? JSON.stringify(value) : value;
  }

  return String(value);
}

function writeErrorFields(
  target: Record<string, LogFieldValue>,
  key: string,
  error: Error
): void {
  const prefix = key || 'error';
  const name = preview(error.name || 'Error');
  const message = preview(error.message || '');
  const code = serializeFieldValue((error as Error & { code?: unknown }).code);
  const stack = error.stack ? preview(error.stack, DEFAULT_STACK_PREVIEW_LIMIT) : undefined;

  target[`${prefix}_name`] = name || 'Error';
  target[`${prefix}_message`] = message;
  if (code !== undefined) {
    target[`${prefix}_code`] = code;
  }
  if (stack !== undefined) {
    target[`${prefix}_stack`] = stack;
  }
}

function normalizeFields(rawFields?: unknown): Record<string, LogFieldValue> | undefined {
  if (rawFields === undefined) {
    return undefined;
  }

  if (rawFields instanceof Error) {
    const fields: Record<string, LogFieldValue> = {};
    writeErrorFields(fields, 'error', rawFields);
    return fields;
  }

  if (!isPlainObject(rawFields)) {
    const detail = serializeFieldValue(rawFields, 'detail');
    return detail === undefined ? undefined : { detail };
  }

  const fields: Record<string, LogFieldValue> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (value === undefined) {
      continue;
    }

    if (value instanceof Error) {
      writeErrorFields(fields, key, value);
      continue;
    }

    const serialized = serializeFieldValue(value, key);
    if (serialized !== undefined) {
      fields[key] = serialized;
    }
  }

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function mergeFields(baseFields?: LogFields, extraFields?: LogFields): LogFields | undefined {
  if (!baseFields && !extraFields) {
    return undefined;
  }

  return {
    ...(baseFields || {}),
    ...(extraFields || {})
  };
}

function isSuppressedScope(scope: string): boolean {
  const normalized = normalizeScope(scope);
  if (!normalized || normalized === 'root') {
    return false;
  }

  const firstSegment = normalized.split('/')[0] || normalized;
  return SUPPRESSED_SCOPE_PREFIXES.includes(firstSegment);
}

function buildInlineFieldSections(fields?: Record<string, LogFieldValue>): {
  correlation: string[];
  detail: string[];
} {
  if (!fields) {
    return { correlation: [], detail: [] };
  }

  const correlation = CORRELATION_FIELD_ORDER
    .flatMap((key) => {
      const value = fields[key];
      if (value === undefined) {
        return [];
      }
      return `${CORRELATION_FIELD_LABELS[key]}=${formatInlineFieldValue(value)}`;
    });

  const detail = Object.entries(fields)
    .filter(([key, value]) => value !== undefined && !CORRELATION_FIELD_ORDER.includes(key as (typeof CORRELATION_FIELD_ORDER)[number]))
    .slice(0, 8)
    .map(([key, value]) => `${key}=${formatInlineFieldValue(value)}`);

  return { correlation, detail };
}

function colorizeSegment(value: string, ansiColor: string, enabled: boolean): string {
  if (!enabled || value.length === 0) {
    return value;
  }

  return `${ansiColor}${value}${ANSI_RESET}`;
}

function formatPrettyLine(event: NormalizedLogEvent, colorize: boolean): string {
  const scope = normalizeScope(event.scope);
  const { correlation, detail } = buildInlineFieldSections(event.fields);
  const parts = [
    formatCompactClock(event.timestamp),
    colorizeSegment(LEVEL_LABELS[event.level], ANSI_LEVEL_COLORS[event.level], colorize),
    scope || 'root',
    ...correlation,
    event.message
  ].filter((part) => part.length > 0);

  if (detail.length > 0) {
    parts.push(colorizeSegment(`| ${detail.join(' ')}`, ANSI_DIM, colorize));
  }

  return parts.join(' ');
}

function formatJsonLine(event: NormalizedLogEvent): string {
  return JSON.stringify({
    time: formatLocalTimestamp(event.timestamp),
    level: event.level,
    scope: normalizeScope(event.scope),
    message: event.message,
    ...(event.fields ? { fields: event.fields } : {})
  });
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

  readonly root: Logger;

  constructor(private readonly options: LoggingServiceOptions = {}) {
    initializeWindowsConsoleUtf8();
    this.root = new ScopedLogger(this, '', undefined);
  }

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

  write(level: LogLevel, scope: string, message: string, rawFields?: LogFields): void {
    if (LEVELS[level] < LEVELS[this.config.level]) {
      return;
    }

    if (isSuppressedScope(scope)) {
      return;
    }

    const timestamp = new Date();
    const fields = normalizeFields(rawFields);
    const event: NormalizedLogEvent = {
      timestamp,
      level,
      scope,
      message,
      fields
    };

    this.buffer.add({
      timestamp: formatLocalTimestamp(timestamp),
      level,
      scope,
      message,
      fields
    });

    this.emit(this.config.pretty
      ? formatPrettyLine(event, shouldColorizePrettyOutput(this.options.colorize))
      : formatJsonLine(event));
  }

  private emit(line: string): void {
    const destination = this.options.destination || process.stdout;
    destination.write(`${line}${process.platform === 'win32' ? '\r\n' : '\n'}`);
  }
}

class ScopedLogger implements Logger {
  constructor(
    private readonly service: LoggingService,
    private readonly scope: string,
    private readonly boundFields?: LogFields
  ) {}

  child(scope: string): Logger {
    return new ScopedLogger(this.service, this.scope ? `${this.scope}/${scope}` : scope, this.boundFields);
  }

  withFields(fields: LogFields): Logger {
    return new ScopedLogger(this.service, this.scope, mergeFields(this.boundFields, fields));
  }

  debug(message: string, fields?: LogFields): void {
    this.service.write('debug', this.scope, message, mergeFields(this.boundFields, fields));
  }

  info(message: string, fields?: LogFields): void {
    this.service.write('info', this.scope, message, mergeFields(this.boundFields, fields));
  }

  warn(message: string, fields?: LogFields): void {
    this.service.write('warn', this.scope, message, mergeFields(this.boundFields, fields));
  }

  error(message: string, fields?: LogFields): void {
    this.service.write('error', this.scope, message, mergeFields(this.boundFields, fields));
  }
}

export const logging = new LoggingService();
export const logger = logging.root;
