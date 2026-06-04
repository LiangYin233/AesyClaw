/**
 * 扩展相关错误
 */

import { AesyClawError, ErrorCode, type ErrorDetails } from './base';

export type ExtensionKind = 'plugin' | 'channel' | 'extension';

/**
 * 扩展错误
 *
 * 用于插件、频道等扩展加载、初始化、权限检查等过程中的错误。
 */
export class ExtensionError extends AesyClawError {
  readonly extensionKind?: ExtensionKind;
  readonly extensionName?: string;
  readonly permission?: string;
  readonly path?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetails & {
      extensionKind?: ExtensionKind;
      extensionName?: string;
      permission?: string;
      path?: string;
    },
    cause?: Error,
  ) {
    super(code, message, details, cause);
    this.extensionKind = details?.extensionKind;
    this.extensionName = details?.extensionName;
    this.permission = details?.permission;
    this.path = details?.path;
  }

  static loadFailed(
    extensionKind: ExtensionKind,
    extensionName: string,
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_LOAD_FAILED,
      `${extensionKind} "${extensionName}" 加载失败: ${message}`,
      { ...details, extensionKind, extensionName },
      cause,
    );
  }

  static initFailed(
    extensionKind: ExtensionKind,
    extensionName: string,
    message: string,
    details?: ErrorDetails,
    cause?: Error,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_INIT_FAILED,
      `${extensionKind} "${extensionName}" 初始化失败: ${message}`,
      { ...details, extensionKind, extensionName },
      cause,
    );
  }

  static notFound(
    extensionKind: ExtensionKind,
    extensionName: string,
    details?: ErrorDetails,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_NOT_FOUND,
      `${extensionKind} "${extensionName}" 未找到`,
      { ...details, extensionKind, extensionName },
    );
  }

  static alreadyRegistered(
    extensionKind: ExtensionKind,
    extensionName: string,
    details?: ErrorDetails,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_ALREADY_REGISTERED,
      `${extensionKind} "${extensionName}" 已注册`,
      { ...details, extensionKind, extensionName },
    );
  }

  static notLoaded(
    extensionKind: ExtensionKind,
    extensionName: string,
    details?: ErrorDetails,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_NOT_LOADED,
      `${extensionKind} "${extensionName}" 未加载`,
      { ...details, extensionKind, extensionName },
    );
  }

  static permissionDenied(
    extensionKind: ExtensionKind,
    extensionName: string,
    permission: string,
    path: string,
    details?: ErrorDetails,
  ): ExtensionError {
    return new ExtensionError(
      ErrorCode.EXTENSION_PERMISSION_DENIED,
      `${extensionKind} "${extensionName}" 没有 ${permission} 权限访问 "${path}"`,
      { ...details, extensionKind, extensionName, permission, path },
    );
  }

  /**
   * 将任意错误规范化为带扩展上下文的 ExtensionError。
   *
   * - ExtensionError/AesyClawError：保留原始错误码和详情，仅补充 phase 上下文。
   * - 普通 Error/非 Error：根据 phase 映射错误码并包装。
   */
  static fromUnknown(
    err: unknown,
    phase: ExtensionFailurePhase,
    extensionKind: ExtensionKind,
    extensionName: string,
  ): ExtensionError {
    if (err instanceof ExtensionError) {
      return err;
    }

    if (AesyClawError.isAesyClawError(err)) {
      return new ExtensionError(
        err.code,
        err.message,
        { ...err.details, phase, extensionKind, extensionName },
        err.cause,
      );
    }

    return new ExtensionError(
      phaseToErrorCode(phase),
      err instanceof Error ? err.message : String(err),
      { phase, extensionKind, extensionName },
      err instanceof Error ? err : undefined,
    );
  }
}

export type ExtensionFailurePhase =
  | 'discover'
  | 'load'
  | 'start'
  | 'enable'
  | 'configReload'
  | 'manualReload';

function phaseToErrorCode(phase: ExtensionFailurePhase): ErrorCode {
  switch (phase) {
    case 'discover':
    case 'load':
      return ErrorCode.EXTENSION_LOAD_FAILED;
    case 'start':
    case 'enable':
    case 'configReload':
    case 'manualReload':
      return ErrorCode.EXTENSION_INIT_FAILED;
  }
}
