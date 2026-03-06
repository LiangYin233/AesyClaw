/**
 * Logger Factory
 *
 * Provides a centralized way to create logger instances with consistent prefixes.
 * Reduces code duplication across the codebase.
 */

import { logger } from './index.js';

export class LoggerFactory {
  /**
   * Create a logger instance with a prefix
   * @param prefix The prefix to use for log messages (typically the class name)
   * @returns A logger instance with the specified prefix
   */
  static create(prefix: string) {
    return logger.child({ prefix });
  }

  /**
   * Create a logger instance from a class constructor
   * @param constructor The class constructor
   * @returns A logger instance with the class name as prefix
   */
  static fromClass(constructor: Function) {
    return logger.child({ prefix: constructor.name });
  }
}
