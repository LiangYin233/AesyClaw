/**
 * 会话模块 — 管理聊天会话的生命周期、消息历史与并发控制。
 *
 * 导出：
 * - Session: 单个会话实例，提供锁、消息增删、压缩等功能
 * - SessionManager: 多会话的缓存与创建管理
 * - calculateActualTokens: 计算消息列表的实际 token 数（从 usage 累加）
 * - calculateEstimatedContextTokens: 估算下一次 LLM 调用前的上下文 token 数
 * - AGENT_PROCESSING_BUSY_MESSAGE: Agent 繁忙时的提示文本
 */

export { Session } from './core';
export { SessionManager, type SessionSummary } from './manager';
export {
  CHARS_PER_TOKEN,
  calculateActualTokens,
  calculateEstimatedContextTokens,
  estimateTextTokens,
} from './utils/token-utils';
export { type SessionMessageDto, toSessionMessageDto } from './persistence/dto';

export const AGENT_PROCESSING_BUSY_MESSAGE = 'Agent处理任务中。';
