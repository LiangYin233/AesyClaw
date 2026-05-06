/** 共享核心类型的兼容导出桶。
 *
 * 本文件作为公共门面，保持所有现有导入者的向后兼容。
 * 底层类型已按领域拆分到独立文件。
 *
 * 新代码应优先从具体的领域文件导入：
 *   - `./identity-types`    — SessionKey、ChannelId、ToolOwner 及序列化工具
 *   - `./message-types`     — Message、SendFn、PipelineResult
 *   - `./database-types`    — 数据库记录类型 (SessionRecord, CronJobRecord, UsageRecord 等)
 */

// ─── 重导出 — 向后兼容 ─────────────────────────────────────────────

export {
  APP_NAME,
  APP_VERSION,
  DIR_NAMES,
  FILE_NAMES,
  DEFAULTS,
  serializeSessionKey,
  parseSerializedSessionKey,
} from './identity-types';

export type { ChannelId, ChatType, ChatId, SessionKey, ToolOwner } from './identity-types';

export type {
  Message,
  MessageComponent,
  PlainComponent,
  ImageComponent,
  RecordComponent,
  VideoComponent,
  FileComponent,
  ReplyComponent,
  UnknownComponent,
  SenderInfo,
  SendFn,
  PipelineResult,
  PersistableMessage,
} from './message-types';

export { getMessageText } from './message-types';

export type {
  SessionRecord,
  CronJobRecord,
  CronRunRecord,
  UsageRecord,
  UsageSummary,
  ToolUsageRecord,
  ToolUsageSummary,
} from './database-types';

// ─── 领域类型 ──────────────────────────────────────────────────────

import type { SessionKey, ToolOwner as ToolOwnerType } from './identity-types';

/** 工具权限过滤模式 */
export type ToolPermissionMode = 'allowlist' | 'denylist';

export type ToolPermissionConfig = {
  mode: ToolPermissionMode;
  list: string[];
};

export type RoleConfig = {
  id: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermissionConfig;
  skills: string[] | ['*'];
  enabled: boolean;
};

export type Skill = {
  name: string;
  description: string;
  content: string;
  isSystem: boolean;
  filePath: string;
};

/** 提供给命令执行函数的上下文 */
export type CommandContext = {
  sessionKey: SessionKey;
};

/** 可注册到 CommandRegistry 的命令 */
export type CommandDefinition = {
  name: string;
  namespace?: string;
  description: string;
  usage?: string;
  allowDuringAgentProcessing?: boolean;
  /** 用于清理的所属子系统作用域；值格式与 ToolOwner 相同。 */
  scope: ToolOwnerType;
  execute: CommandExecuteFn;
};

/** 命令执行函数签名 */
export type CommandExecuteFn = (args: string[], context: CommandContext) => Promise<string>;

// ─── 实用类型 ──────────────────────────────────────────────────────

/** 递归地将所有属性设为可选 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ConfigChangeListener<T> = (newValue: T, oldValue: T) => void | Promise<void>;
export type Unsubscribe = () => void;
