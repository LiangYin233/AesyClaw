import type { AgentSkill } from 'aesyiu';
import type { FullConfig } from '@/features/config/schema.js';
import type { CronExecutor } from '@/features/cron/types.js';
import type { RoleConfig, RoleWithMetadata } from '@/features/roles/types.js';
import type { ChatKey, ChatSession } from '@/platform/db/repositories/session-repository.js';
import type { StandardMessage } from '@/platform/llm/types.js';

export interface ConfigSource {
  getConfig(): FullConfig;
}

export interface RoleCatalog {
  getRolesList(): Array<{ id: string; name: string; description: string }>;
}

export interface RoleStore extends RoleCatalog {
  getRole(roleId: string): RoleWithMetadata | null;
  getRoleConfig(roleId: string): RoleConfig;
  getAllRoles(): RoleWithMetadata[];
  getAllowedTools(roleId: string, allTools: string[]): string[];
  isToolAllowed(roleId: string, toolName: string): boolean;
}

export interface SkillStore {
  isInitialized(): boolean;
  getSkillsForRole(skillIds: string[]): AgentSkill[];
}

export interface ChatSessionStore {
  get(key: ChatKey): ChatSession | null;
  create(key: ChatKey): ChatSession;
  updateRole(key: ChatKey, roleId: string): void;
  getMessages(key: ChatKey): StandardMessage[];
  saveMessages(key: ChatKey, messages: StandardMessage[]): void;
  count(): number;
}

export interface PathResolverService {
  initialize(): void;
  isInitialized(): boolean;
}

export interface ConfigManagerService {
  initialize(): Promise<void>;
  isInitialized(): boolean;
  readonly config: FullConfig;
  syncAllDefaultConfigs(): Promise<void>;
  onConfigChange(listener: (_next: FullConfig, _prev: FullConfig) => void | Promise<void>): () => void;
  destroy(): Promise<void>;
}

export interface SQLiteManagerService {
  initialize(): void;
  close(): void;
  isInitialized(): boolean;
}

export interface RoleManagerService extends RoleStore {
  initialize(): Promise<void>;
  shutdown(): void;
  isInitialized(): boolean;
}

export interface SkillManagerService extends SkillStore {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getStats(): Record<string, unknown>;
}

export interface CronServiceRuntime {
  setExecutor(executor: CronExecutor): void;
  start(): void;
  stop(): Promise<void>;
  isRunning(): boolean;
  getScheduledTaskCount(): number;
}
