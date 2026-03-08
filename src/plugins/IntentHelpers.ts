import type { InboundMessage, ProcessingIntent } from '../types.js';

/**
 * 语义化的 Intent 构造器
 * 提供便捷的 API 来创建 ProcessingIntent 对象
 */
export const Intent = {
  /** 继续 LLM 处理（默认行为） */
  continue: (): ProcessingIntent => ({ type: 'continue' }),

  /** 直接回复，跳过 LLM */
  reply: (reason: string): ProcessingIntent => ({ type: 'reply', reason }),

  /** 插件已完全处理（已调用 LLM） */
  handled: (reason: string): ProcessingIntent => ({ type: 'handled', reason }),

  /** 状态提示消息 */
  status: (reason: string): ProcessingIntent => ({ type: 'status', reason }),

  /** 错误消息 */
  error: (reason: string): ProcessingIntent => ({ type: 'error', reason })
};

/**
 * 判断消息是否应该跳过 LLM 处理
 */
export function shouldSkipLLM(msg: InboundMessage): boolean {
  return msg.intent ? msg.intent.type !== 'continue' : false;
}

/**
 * 获取跳过 LLM 的原因（用于日志）
 */
export function getSkipReason(msg: InboundMessage): string {
  if (msg.intent && msg.intent.type !== 'continue') {
    return `${msg.intent.type}: ${msg.intent.reason}`;
  }
  return 'unknown';
}
