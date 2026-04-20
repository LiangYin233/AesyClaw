/** @file 日志系统
 *
 * 基于 pino 的日志系统，开发环境使用 pino-pretty 输出格式化日志，
 * 生产环境使用 JSON 格式输出。
 *
 * ScopedLogger 提供带作用域前缀的日志接口，createScopedLogger()
 * 用于为插件/频道等模块创建带前缀的日志器。
 */

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

/** 全局日志器实例 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/** 带作用域前缀的日志器接口 */
export interface ScopedLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/** 创建带作用域前缀的日志器
 *
 * 输出格式：`[scope] message`，并自动在日志数据中附加 scope 字段。
 */
export function createScopedLogger(scope: string, scopeKey: string = 'scope'): ScopedLogger {
  const make = (level: LogLevel) =>
    (msg: string, data?: Record<string, unknown>) =>
      logger[level]({ [scopeKey]: scope, ...data }, `[${scope}] ${msg}`);
  return {
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  };
}
