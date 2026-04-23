/** @file 工具相关类型的 SDK 公共导出
 *
 * 供插件开发者 import 使用的统一入口。
 * 使用方式：`import type { Tool, ToolExecuteContext } from '@/sdk/tools.js'`
 */
export type {
    Tool,
    ToolDefinition,
    ToolExecuteContext,
    ToolExecutionResult,
    ToolMediaFile,
    ToolParameters,
    ToolSendPayload,
} from '@/platform/tools/types.js';

export { typeboxToToolParameters } from '@/platform/tools/types.js';
