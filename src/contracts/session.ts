/**
 * contracts/session — 会话运行时契约。
 *
 * 仅定义 hook 层需要的最小接口，不依赖具体 Session 实现。
 */

import type { SessionKey } from '@aesyclaw/core/types';
import type { AgentMessage, ModelResolver } from '@aesyclaw/contracts/llm';

/** Hook 层可用的会话运行时引用（Session 的最小视图） */
export type SessionRuntimeRef = {
  readonly sessionId: string;
  readonly key: SessionKey;
  readonly isLocked: boolean;
  lock(): boolean;
  unlock(): void;
  get(): readonly AgentMessage[];
  add(message: AgentMessage): Promise<void>;
  bind(): Promise<void>;
  clear(): Promise<void>;
  compact(llmAdapter: ModelResolver, modelIdentifier: string): Promise<string>;
};
