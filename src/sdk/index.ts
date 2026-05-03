/**
 * @aesyclaw/sdk — 外部扩展的稳定公共 API。
 *
 * 外部扩展（extensions/plugin_*、extensions/channel_*）应始终通过此模块
 * 导入 AesyClaw 类型和工具函数，而非直接导入内部路径。
 *
 * 内部重构时，只需更新此文件的重新导出路径，
 * 所有外部扩展代码无需修改。
 */

export type { PluginContext, PluginDefinition } from '../extension/plugin/plugin-types';

export type { ChannelContext, ChannelPlugin } from '../extension/channel/channel-types';

export type {
  InboundMessage,
  OutboundMessage,
  SessionKey,
  MediaAttachment,
  PipelineResult,
} from '../core/types';

export type { AesyClawTool, ToolExecutionResult } from '../tool/tool-registry';

export type { OnSendContext } from '../pipeline/middleware/types';

export { resolvePaths } from '../core/path-resolver';
