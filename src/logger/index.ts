export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
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

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
  showTimestamp?: boolean;
  useColors?: boolean;
}

export class Logger {
  private level: LogLevel;
  private prefix: string;
  private showTimestamp: boolean;
  private useColors: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level || 'info';
    this.prefix = options.prefix || '';
    this.showTimestamp = options.showTimestamp ?? true;
    this.useColors = options.useColors ?? true;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  isLevelEnabled(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[this.level];
  }

  private format(level: LogLevel, message: string): string {
    const parts: string[] = [];
    
    if (this.showTimestamp) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
      parts.push(this.useColors ? `${COLORS.gray}${timestamp}${COLORS.reset}` : timestamp);
    }
    
    const prefixStr = this.prefix ? `[${this.prefix}]` : '';
    const levelStr = PREFIXES[level];
    const color = this.useColors ? PREFIX_COLORS[level] : '';
    const reset = this.useColors ? COLORS.reset : '';
    
    parts.push(`${color}${prefixStr}${prefixStr ? ' ' : ''}[${levelStr}]${reset}`);
    parts.push(message);
    
    return parts.join(' ');
  }

  debug(message: string, ...args: any[]): void {
    if (!this.shouldLog('debug')) return;
    console.log(this.format('debug', message), ...args);
  }

  info(message: string, ...args: any[]): void {
    if (!this.shouldLog('info')) return;
    console.log(this.format('info', message), ...args);
  }

  warn(message: string, ...args: any[]): void {
    if (!this.shouldLog('warn')) return;
    console.warn(this.format('warn', message), ...args);
  }

  error(message: string, ...args: any[]): void {
    if (!this.shouldLog('error')) return;
    console.error(this.format('error', message), ...args);
  }

  child(options: LoggerOptions): Logger {
    return new Logger({
      level: this.level,
      prefix: options.prefix || this.prefix,
      showTimestamp: options.showTimestamp ?? this.showTimestamp,
      useColors: options.useColors ?? this.useColors
    });
  }
}

export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

export const logger = new Logger();
