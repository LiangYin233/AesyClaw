import { completeMessageUsage } from '@aesyclaw/core/types';
import type { Usage } from '@earendil-works/pi-ai';
import type { AgentMessage } from '@aesyclaw/contracts/llm';
import { ApiType } from '@aesyclaw/contracts/llm';

export type {
  AgentMessage,
  ResolvedModel,
  StreamFn,
  AgentTool,
  AgentToolResult,
} from '@aesyclaw/contracts/llm';

export {
  ApiType,
  makeExtraBodyOnPayload,
} from '@aesyclaw/contracts/llm';

const ZERO_USAGE: Usage = completeMessageUsage();

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
