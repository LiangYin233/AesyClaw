/**
 * 会话模块 — 管理聊天会话的生命周期、消息历史与并发控制。
 *
 * 导出：
 * - Session: 单个会话实例，提供锁、消息增删、压缩等功能
 * - SessionManager: 多会话的缓存与创建管理
 * - estimateApproximateTokens: 估算消息列表的 token 数
 * - AGENT_PROCESSING_BUSY_MESSAGE: Agent 繁忙时的提示文本
 */

export { Session, estimateApproximateTokens } from './session';
export { SessionManager } from './manager';

export const AGENT_PROCESSING_BUSY_MESSAGE = 'Agent处理任务中。';
