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

} from '@aesyclaw/core/types';

export { getMessageText } from '@aesyclaw/core/types';

export { isRecord, errorMessage } from '@aesyclaw/core/utils';

export type { AesyClawTool, ToolExecutionResult } from '@aesyclaw/tool/tool-registry';

export type { HookCtx, HookResult, Middleware, HookRegistration } from '@aesyclaw/hook';

export type { ResolvedPaths } from '@aesyclaw/core/path-resolver';
export { resolvePaths } from '@aesyclaw/core/path-resolver';
