/** 标识符类型 — SessionKey、频道/聊天 ID、所有者标记及运行时常量。 */

import pkg from '../../package.json';

// ─── 常量 ───────────────────────────────────────────────────────────

export const APP_NAME = 'AesyClaw';
export const APP_VERSION = pkg.version;

/** 默认目录名（相对于根目录） */
export const DIR_NAMES = {
  runtimeRoot: '.aesyclaw',
  data: 'data',
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
  roles: 'roles.json',
} as const;

/** 运行时默认值和模式元数据共享的默认配置值 */
export const DEFAULTS = {
  port: 3000,
  host: '0.0.0.0',
  logLevel: 'info',
  compressionThreshold: 0.8,
} as const;

// ─── 标识符类型 ───────────────────────────────────────────────────

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
};

/**
 * 运行时所有者标识符，用于基于所有权的注册和清理。
 * CommandDefinition.scope 使用相同的值作为其所属子系统的作用域；
 * 工具定义将其作为所有者暴露。公共字段名刻意保持不同，
 * 因为它们描述的是不同的 API 领域。
 */
export type ToolOwner = 'system' | `plugin:${string}` | `mcp:${string}`;

// ─── SessionKey 序列化 ────────────────────────────────────────────

export function serializeSessionKey(key: SessionKey): string {
  return JSON.stringify({ channel: key.channel, type: key.type, chatId: key.chatId });
}

export function parseSerializedSessionKey(value: string): SessionKey {
  const parsed: unknown = JSON.parse(value);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>)['channel'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['type'] !== 'string' ||
    typeof (parsed as Record<string, unknown>)['chatId'] !== 'string'
  ) {
    throw new Error(`无效的 SessionKey 序列化: ${value}`);
  }
  const record = parsed as Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- validated above via isRecord guard
  return { channel: record['channel']!, type: record['type']!, chatId: record['chatId']! };
}
