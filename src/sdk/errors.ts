/** @file 错误处理工具的 SDK 公共导出
 *
 * 将任意错误值安全地转换为字符串消息，供插件统一错误处理使用。
 * 使用方式：`import { toErrorMessage } from '@/sdk/errors.js'`
 */
export { toErrorMessage } from '@/platform/utils/errors.js';
