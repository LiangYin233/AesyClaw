/** Shared identifier types used across runtime modules. */

/** Channel source identifier (e.g. 'onebot', 'discord') */
export type ChannelId = string;

/** Chat type discriminator (e.g. 'private', 'group') */
export type ChatType = string;

/** Chat target identifier (group or user id) */
export type ChatId = string;

/** Composite key that uniquely identifies a session */
export interface SessionKey {
  channel: ChannelId;
  type: ChatType;
  chatId: ChatId;
}

/**
 * Runtime owner identifier used for ownership-based registration and cleanup.
 * CommandDefinition.scope uses this same value as its owning subsystem scope;
 * tool definitions expose it as owner. The public field names intentionally
 * remain distinct because they describe different API domains.
 */
export type ToolOwner = 'system' | `plugin:${string}` | `mcp:${string}`;
