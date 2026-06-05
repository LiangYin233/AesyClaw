/**
 * 统一错误处理系统
 *
 * 导出所有错误类型、工厂函数和工具
 */

// 基础错误类和错误码
export { AesyClawError, ErrorCode, type ErrorDetails } from './base';

// 专门的错误类型
export { AgentExecutionError } from './agent';
export { ToolExecutionError } from './tool';
export { ConfigurationError } from './config';
export { ExtensionError, type ExtensionKind, type ExtensionFailurePhase } from './extension';

// 错误工厂
export { ErrorFactory } from './factory';

// 错误追踪
export { ErrorTracker } from './tracker';

// 错误处理工具
export { errorMessage } from './utils';
