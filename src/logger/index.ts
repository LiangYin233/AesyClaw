export type LogLevel = 'debug' | 'info' | 'warn' | 'error';  // 日志级别类型

const LEVELS: Record<LogLevel, number> = {  // 日志级别数值映射
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const COLORS = {  // ANSI 颜色码
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

const PREFIXES: Record<LogLevel, string> = {  // 日志级别前缀
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
};

const PREFIX_COLORS: Record<LogLevel, string> = {  // 日志级别对应的颜色
  debug: COLORS.gray,
  info: COLORS.cyan,
  warn: COLORS.yellow,
  error: COLORS.red
};

export interface LoggerOptions {
  level?: LogLevel;  // 日志级别
  prefix?: string;  // 日志前缀
  showTimestamp?: boolean;  // 是否显示时间戳
  useColors?: boolean;  // 是否使用颜色
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

  setLevel(level: LogLevel): void {  // 设置日志级别
    this.level = level;
  }

  isLevelEnabled(level: LogLevel): boolean {  // 检查日志级别是否启用
    return LEVELS[level] >= LEVELS[this.level];
  }

  private shouldLog(level: LogLevel): boolean {  // 判断是否应该记录该级别日志
    return LEVELS[level] >= LEVELS[this.level];
  }

  private format(level: LogLevel, message: string): string {  // 格式化日志消息
    const parts: string[] = [];
    
    if (this.showTimestamp) {
      const timestamp = new Date().toISOString().split('T')[1].slice(0, -1);  // 提取时间部分
      parts.push(this.useColors ? `${COLORS.gray}${timestamp}${COLORS.reset}` : timestamp);
    }
    
    const prefixStr = this.prefix ? `[${this.prefix}]` : '';  // 格式化前缀
    const levelStr = PREFIXES[level];
    const color = this.useColors ? PREFIX_COLORS[level] : '';  // 获取级别颜色
    const reset = this.useColors ? COLORS.reset : '';
    
    parts.push(`${color}${prefixStr}${prefixStr ? ' ' : ''}[${levelStr}]${reset}`);
    parts.push(message);
    
    return parts.join(' ');
  }

  debug(message: string, ...args: any[]): void {  // 调试日志
    if (!this.shouldLog('debug')) return;
    console.log(this.format('debug', message), ...args);
  }

  info(message: string, ...args: any[]): void {  // 信息日志
    if (!this.shouldLog('info')) return;
    console.log(this.format('info', message), ...args);
  }

  warn(message: string, ...args: any[]): void {  // 警告日志
    if (!this.shouldLog('warn')) return;
    console.warn(this.format('warn', message), ...args);
  }

  error(message: string, ...args: any[]): void {  // 错误日志
    if (!this.shouldLog('error')) return;
    console.error(this.format('error', message), ...args);
  }

  child(options: LoggerOptions): Logger {  // 创建子日志记录器
    return new Logger({
      level: this.level,
      prefix: options.prefix || this.prefix,
      showTimestamp: options.showTimestamp ?? this.showTimestamp,
      useColors: options.useColors ?? this.useColors
    });
  }
}

export function createLogger(options?: LoggerOptions): Logger {  // 创建日志记录器工厂函数
  return new Logger(options);
}

export const logger = new Logger();  // 全局默认日志实例
