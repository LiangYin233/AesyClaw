/**
 * Global type definitions for AesyClaw.
 *
 * These types are used across multiple modules. Module-scoped types
 * that are only relevant within a single subsystem should live in
 * that module's own `*-types.ts` or `*-schema.ts` file.
 */

// ─── Identifiers ─────────────────────────────────────────────────

/** Channel source identifier (e.g. 'onebot', 'discord') */
type ChannelId = string;

/** Chat type discriminator (e.g. 'private', 'group') */
type ChatType = string;

/** Chat target identifier (group or user id) */
type ChatId = string;

/** Composite key that uniquely identifies a session */
interface SessionKey {
  channel: ChannelId;
  type: ChatType;
  chatId: ChatId;
}

/** Tool owner scope — used for ownership-based registration & auto-cleanup */
type ToolOwner = 'system' | `plugin:${string}` | `mcp:${string}`;

/** Tool permission filtering mode */
type ToolPermissionMode = 'allowlist' | 'denylist';

// ─── Messages ────────────────────────────────────────────────────

/** Media attachment carried alongside a message */
interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'file';
  url?: string;
  path?: string;
  base64?: string;
  mimeType?: string;
}

/** Information about the message sender */
interface SenderInfo {
  id: string;
  name?: string;
  role?: string;
}

/** Message arriving from an external platform into the pipeline */
interface InboundMessage {
  sessionKey: SessionKey;
  content: string;
  attachments?: MediaAttachment[];
  sender?: SenderInfo;
  rawEvent?: unknown;
}

/** Reply produced by the pipeline and sent back through a channel */
interface OutboundMessage {
  content: string;
  attachments?: MediaAttachment[];
}

// ─── Pipeline ───────────────────────────────────────────────────

/** Result of processing a message through the pipeline or a hook */
type PipelineResult =
  | { action: 'continue'; data?: unknown }
  | { action: 'block'; reason?: string }
  | { action: 'respond'; content: string };

// ─── Persistable Message (database layer) ────────────────────────

/** Message record persisted in the database */
interface PersistableMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

/** Database record for a session */
interface SessionRecord {
  id: string;
  channel: string;
  type: string;
  chatId: string;
  createdAt: string;
}

/** Database record for a cron job */
interface CronJobRecord {
  id: string;
  scheduleType: string;
  scheduleValue: string;
  prompt: string;
  sessionKey: string;
  nextRun: string | null;
  createdAt: string;
}

/** Database record for a cron run */
interface CronRunRecord {
  id: string;
  jobId: string;
  status: string;
  result: string | null;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

// ─── Tool Permissions ────────────────────────────────────────────

interface ToolPermissionConfig {
  mode: ToolPermissionMode;
  list: string[];
}

// ─── Role ────────────────────────────────────────────────────────

interface RoleConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  toolPermission: ToolPermissionConfig;
  skills: string[] | ['*'];
  enabled: boolean;
}

// ─── Skill ───────────────────────────────────────────────────────

interface Skill {
  name: string;
  description: string;
  content: string;
  isSystem: boolean;
  filePath: string;
}

// ─── DeepPartial utility ─────────────────────────────────────────

/** Recursively make all properties optional */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ─── Config change listener types ────────────────────────────────

type ConfigChangeListener<T> = (newValue: T, oldValue: T) => void | Promise<void>;
type Unsubscribe = () => void;

export type {
  ChannelId,
  ChatType,
  ChatId,
  SessionKey,
  ToolOwner,
  ToolPermissionMode,
  MediaAttachment,
  SenderInfo,
  InboundMessage,
  OutboundMessage,
  PipelineResult,
  PersistableMessage,
  SessionRecord,
  CronJobRecord,
  CronRunRecord,
  ToolPermissionConfig,
  RoleConfig,
  Skill,
  DeepPartial,
  ConfigChangeListener,
  Unsubscribe,
};