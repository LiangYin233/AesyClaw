/** 共享核心类型的兼容导出桶。 */

import pkg from '../../package.json';

export const APP_NAME = 'AesyClaw';
export const APP_VERSION = pkg.version;

/** 默认目录名（相对于根目录） */
export const DIR_NAMES = {
  runtimeRoot: '.aesyclaw',
  data: 'data',
  roles: 'roles',
  media: 'media',
  workspace: 'workspace',
  /**
   * 内置 skills 目录（项目根目录下）。
   * 实际路径由 resolvePaths 基于 root 解析为 `<project>/skills/`。
   */
  skills: 'skills',
  extensions: 'extensions',
} as const;

/** 默认文件名 */
export const FILE_NAMES = {
  config: 'config.json',
  database: 'aesyclaw.db',
} as const;

/** 运行时默认值和模式元数据共享的默认配置值 */
export const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  compressionThreshold: 0.8,
} as const;

// ─── 标识符类型 (identity-types) ──────────────────────────────────

/** 频道来源标识符（如 'onebot'、'discord'） */
export type ChannelId = string;

/** 聊天类型标识（如 'private'、'group'） */
export type ChatType = string;

/** 聊天目标标识符（群组或用户 ID） */
export type ChatId = string;

/**
 * 唯一标识一个会话的复合键
 */
export type SessionKey = {
  channel: ChannelId;
  type: ChatType;
  chatId: ChatId;
}

/**
 * 运行时所有者标识符，用于基于所有权的注册和清理。
 * CommandDefinition.scope 使用相同的值作为其所属子系统的作用域；
 * 工具定义将其作为所有者暴露。公共字段名刻意保持不同，
 * 因为它们描述的是不同的 API 领域。
 */
export type ToolOwner = 'system' | `plugin:${string}` | `mcp:${string}`;

// ─── 消息类型 (message-types) ─────────────────────────────────────

/** 随消息一起携带的媒体附件 */
export type MediaAttachment = {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  path?: string;
  base64?: string;
  mimeType?: string;
}

/** 消息发送者信息 */
export type SenderInfo = {
  id: string;
  name?: string;
  role?: string;
}

/** 从外部平台进入管道的传入消息 */
export type InboundMessage = {
  sessionKey: SessionKey;
  content: string;
  attachments?: MediaAttachment[];
  sender?: SenderInfo;
  rawEvent?: unknown;
}

/** 由管道生成并通过频道发送回去的回复 */
export type OutboundMessage = {
  content: string;
  attachments?: MediaAttachment[];
}

/** 通过频道发送传出消息的函数 */
export type SendFn = (message: OutboundMessage) => Promise<void>;

/** 消息经过管道或钩子处理后的结果 */
export type PipelineResult =
  | { action: 'continue'; data?: unknown }
  | { action: 'block'; reason?: string }
  | { action: 'respond'; content: string; attachments?: MediaAttachment[] };

/** 持久化到数据库的消息记录 */
export type PersistableMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

// ─── 数据库类型 (database-types) ───────────────────────────────────

/** 会话的数据库记录 */
export type SessionRecord = {
  id: string;
  channel: string;
  type: string;
  chatId: string;
}

/** 定时任务的数据库记录 */
export type CronJobRecord = {
  id: string;
  scheduleType: string;
  scheduleValue: string;
  prompt: string;
  sessionKey: string;
  nextRun: string | null;
  createdAt: string;
}

/** 定时任务执行的数据库记录 */
export type CronRunRecord = {
  id: string;
  jobId: string;
  status: string;
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** 用量记录 — 存入数据库前的原始插入载荷 */
export type UsageRecord = {
  model: string;
  provider: string;
  api: string;
  responseId?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
}

/** 聚合用量汇总（按模型 + 日期分组） */
export type UsageSummary = {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
}

/** 工具/技能调用记录 — 存入数据库前的原始插入载荷 */
export type ToolUsageRecord = {
  name: string;
  type: 'tool' | 'skill';
}

/** 聚合工具/技能调用汇总（按名称 + 类型 + 日期分组） */
export type ToolUsageSummary = {
  name: string;
  type: 'tool' | 'skill';
  date: string;
  count: number;
}

// ─── 领域类型 (domain-types) ──────────────────────────────────────

/** 工具权限过滤模式 */
export type ToolPermissionMode = 'allowlist' | 'denylist';

export type ToolPermissionConfig = {
  mode: ToolPermissionMode;
  list: string[];
}

export type RoleConfig = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermissionConfig;
  skills: string[] | ['*'];
  enabled: boolean;
}

export type Skill = {
  name: string;
  description: string;
  content: string;
  isSystem: boolean;
  filePath: string;
}

/** 提供给命令执行函数的上下文 */
export type CommandContext = {
  sessionKey: SessionKey;
}

/** 可注册到 CommandRegistry 的命令 */
export type CommandDefinition = {
  name: string;
  namespace?: string;
  description: string;
  usage?: string;
  allowDuringAgentProcessing?: boolean;
  /** 用于清理的所属子系统作用域；值格式与 ToolOwner 相同。 */
  scope: ToolOwner;
  execute: CommandExecuteFn;
}

/** 命令执行函数签名 */
export type CommandExecuteFn = (args: string[], context: CommandContext) => Promise<string>;

// ─── 实用类型 (utility-types) ─────────────────────────────────────

/** 递归地将所有属性设为可选 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type ConfigChangeListener<T> = (newValue: T, oldValue: T) => void | Promise<void>;
export type Unsubscribe = () => void;
