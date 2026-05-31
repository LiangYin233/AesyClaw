/**
 * 配置相关错误
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';

/**
 * 配置错误
 *
 * 用于配置文件解析、验证、加载等过程中的错误
 */
export class ConfigurationError extends AesyClawError {
  /** 配置文件路径 */
  readonly configPath?: string;

  /** 配置键 */
  readonly configKey?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails & {
      configPath?: string;
      configKey?: string;
    },
    cause?: Error,
  ) {
    super(code, message, details, cause);
    this.configPath = details?.configPath;
    this.configKey = details?.configKey;
  }

  /**
   * 创建配置无效错误
   */
  static invalid(message: string, details?: ErrorDetails, cause?: Error): ConfigurationError {
    return new ConfigurationError(ErrorCode.CONFIG_INVALID, message, details, cause);
  }

  /**
   * 创建配置缺失错误
   */
  static missing(configKey: string, details?: ErrorDetails): ConfigurationError {
    return new ConfigurationError(
      ErrorCode.CONFIG_MISSING,
      `配置项 "${configKey}" 缺失`,
      { ...details, configKey },
    );
  }

  /**
   * 创建配置解析失败错误
   */
  static parseFailed(
    configPath: string,
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ConfigurationError {
    return new ConfigurationError(
      ErrorCode.CONFIG_PARSE_FAILED,
      `配置文件 "${configPath}" 解析失败: ${message}`,
      { ...details, configPath },
      cause,
    );
  }

  /**
   * 创建配置验证失败错误
   */
  static validationFailed(
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ConfigurationError {
    return new ConfigurationError(
      ErrorCode.CONFIG_VALIDATION_FAILED,
      `配置验证失败: ${message}`,
      details,
      cause,
    );
  }

  /**
   * 创建配置 Schema 不匹配错误
   */
  static schemaMismatch(
    configKey: string,
    expected: string,
    actual: string,
    details?: ErrorDetails,
  ): ConfigurationError {
    return new ConfigurationError(
      ErrorCode.CONFIG_SCHEMA_MISMATCH,
      `配置项 "${configKey}" 类型不匹配: 期望 ${expected}, 实际 ${actual}`,
      { ...details, configKey, expected, actual },
    );
  }
}
