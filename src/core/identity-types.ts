/** 在运行时模块间共享的标识符类型。 */

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
