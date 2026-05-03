/**
 * @aesyclaw/sdk — 外部扩展的稳定公共 API。
 *
 * 外部扩展（extensions/plugin_*、extensions/channel_*）应始终通过此模块
 * 导入 AesyClaw 类型和工具函数，而非直接导入内部路径。
 *
 * 内部重构时，只需更新此文件的重新导出路径，
 * 所有外部扩展代码无需修改。
 */

export type { PluginContext, PluginDefinition } from '@aesyclaw/extension/plugin/plugin-types';

export type { ChannelContext, ChannelPlugin } from '@aesyclaw/extension/channel/channel-types';

export type {
  Message,
  InboundMessage,
  OutboundMessage,
  SessionKey,
  SenderInfo,
  MessageComponent,
  PlainComponent,
  ImageComponent,
  RecordComponent,
  VideoComponent,
  FileComponent,
  ReplyComponent,
  UnknownComponent,
  PipelineResult,
} from '@aesyclaw/core/types';

export { getMessageText, getInboundMessageText, getOutboundMessageText } from '@aesyclaw/core/types';

export type { AesyClawTool, ToolExecutionResult } from '@aesyclaw/tool/tool-registry';

export type { OnSendContext } from '@aesyclaw/pipeline/middleware/types';

export { resolvePaths } from '@aesyclaw/core/path-resolver';
