/**
 * contracts/pipeline — 管道契约。
 *
 * 外部模块（Cron、Channel）通过此接口消费 Pipeline，
 * 不再直接依赖 Pipeline 具体类。
 */

import type { Message, SessionKey, SenderInfo, SendFn } from '@aesyclaw/core/types';

/** 消息处理器 — Pipeline 对外的最小接口 */
export type MessageProcessor = {
  receiveWithSend(
    message: Message,
    sessionKey: SessionKey,
    sender: SenderInfo | undefined,
    send: SendFn,
  ): Promise<void>;
};
