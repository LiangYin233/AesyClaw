/**
 * contracts/agent — Agent 运行时契约。
 *
 * Hook 层和外部模块可通过此接口引用 Agent，
 * 而无需直接依赖 agent/agent 具体类。
 */

import type {
  RoleConfig,
  SessionKey,
  Message,
} from '@aesyclaw/core/types';
import type {
  AgentMessage,
  ResolvedModel,
} from '@aesyclaw/contracts/llm';
import type { StreamMessage } from '@aesyclaw/core/stream-types';
import type { SessionRuntimeRef } from '@aesyclaw/contracts/session';

/** callLLM 的返回结果 */
export type CallLLMResult = {
  newMessages: AgentMessage[];
  lastAssistant: string | null;
  cancelled: boolean;
};

/** Hook 层可用的 Agent 运行时引用 */
export type AgentRuntimeRef = {
  readonly session: SessionRuntimeRef;
  roleId?: string;
  readonly model: ResolvedModel;
  readonly activeRole: RoleConfig | null;
  setModel(modelId: string): void;
  setRole(role: RoleConfig): Promise<void>;
  invalidatePromptCache(): void;
  callLLM(
    role: RoleConfig,
    content: string,
    history: AgentMessage[],
    sessionKey: SessionKey,
    sendMessage?: (message: Message) => Promise<boolean>,
    onStream?: (event: StreamMessage) => void,
  ): Promise<CallLLMResult>;
  /** 处理用户消息并返回回复 */
  process(
    message: Message,
    sendMessage?: (message: Message) => Promise<boolean>,
    options?: { ephemeral?: boolean; role?: RoleConfig },
    onStream?: (event: StreamMessage) => void,
  ): Promise<Message>;
};
