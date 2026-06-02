/**
 * 兼容导出桶 — 大部分类型已迁移到 @aesyclaw/contracts/llm。
 *
 * 外部/内部代码均可继续从此导入，无需立即修改。
 */

import { createZeroMessageUsage } from '@aesyclaw/core/types';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { ApiType } from '@aesyclaw/contracts/llm';

// ─── 从此处 re-export 的类型 ─────────────────────────────────────
export type {
  AgentMessage,
  ResolvedModel,
  StreamFn,
  AgentTool,
  AgentToolResult,
} from '@aesyclaw/contracts/llm';

// ─── 从此处 re-export 的值 ───────────────────────────────────────
export {
  ApiType,
  makeExtraBodyOnPayload,
  createUserMessage,
  extractMessageText,
  assistantHasToolCalls,
} from '@aesyclaw/contracts/llm';

// ─── 保留在 agent 专属模块的功能 ─────────────────────────────────
// createPersistedAssistantMessage 需要 @aesyclaw/core/types 的
// createZeroMessageUsage，不适宜放入轻量 contracts 层。

const ZERO_USAGE: Usage = createZeroMessageUsage();

/** 创建一个持久化的助手消息。 */
export function createPersistedAssistantMessage(
  content: string,
  timestamp: number = Date.now(),
  usage: Usage = ZERO_USAGE,
): AgentMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: ApiType.OPENAI_RESPONSES,
    provider: 'persisted-history',
    model: 'persisted-history',
    usage,
    stopReason: 'stop',
    timestamp,
  };
}
