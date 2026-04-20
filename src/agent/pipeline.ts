/** @file 频道消息处理流水线
 *
 * ChannelPipeline 实现了洋葱模型中间件链，处理频道的收发消息。
 * 消息处理流程：
 * 1. dispatchReceive 钩子 — 插件可修改或阻止收到的消息
 * 2. 中间件链执行 — 按注册顺序依次执行（ConfigStage → SessionStage → CommandMiddleware → AgentStage）
 * 3. dispatchSend 钩子 — 插件可修改或阻止发送的回复
 * 4. 通过 ctx.send 回发 — 将最终回复发送到频道
 *
 * 任何阶段返回 block 即跳过后续处理，消息不会被继续传递。
 */

import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import type {
    ChannelContext,
    ChannelReceiveMessage,
    ChannelSendMessage,
    MiddlewareFunc,
} from './types.js';
import type { ChannelSendPayload } from '@/channels/channel-plugin.js';
import { logger } from '@/platform/observability/logger.js';
import { toErrorMessage } from '@/platform/utils/errors.js';

/** 频道消息处理流水线
 *
 * 管理中间件链与钩子分发，是消息从频道进入系统到回复发出的核心通道。
 */
export class ChannelPipeline {
    private middlewares: MiddlewareFunc[] = [];
    private hookRuntime: PluginHookRuntime;

    constructor(hookRuntime: PluginHookRuntime) {
        this.hookRuntime = hookRuntime;
    }

    /** 注册中间件到链尾，执行顺序与注册顺序一致 */
    use(middleware: MiddlewareFunc): void {
        this.middlewares.push(middleware);
        logger.debug({ middlewareCount: this.middlewares.length }, 'Middleware registered');
    }

    /** 处理收到的消息（不带 send 回调） */
    async receive(message: ChannelReceiveMessage): Promise<ChannelContext> {
        return this.receiveWithSend(message, undefined);
    }

    /** 处理收到的消息并可选地回发回复
     *
     * 完整流程：
     * 1. 触发 onReceive 钩子，插件可修改或阻止消息
     * 2. 执行中间件链，各阶段处理消息并填充 ctx.sendMessage
     * 3. 触发 onSend 钩子，插件可修改或阻止回复
     * 4. 若提供了 send 回调且有回复内容，调用 send 发送到频道
     */
    async receiveWithSend(
        message: ChannelReceiveMessage,
        send?: (_payload: ChannelSendPayload) => Promise<void>,
    ): Promise<ChannelContext> {
        const startTime = Date.now();

        logger.info(
            { chatId: message.chatId, text: message.text },
            'Received inbound message, dispatching to middleware chain',
        );

        // 阶段 1：onReceive 钩子 — 插件可修改或阻止消息
        const hookResult = await this.hookRuntime.dispatchReceive({
            message: {
                channelId: message.channelId,
                chatId: message.chatId,
                text: message.text,
                timestamp: message.timestamp,
                metadata: message.metadata,
            },
        });

        if (hookResult.blocked) {
            logger.info(
                { chatId: message.chatId, reason: hookResult.reason },
                'Message blocked by plugin, skipping further processing',
            );
            return {
                received: message,
                sendMessage: { text: '', mediaFiles: [] },
                createdAt: Date.now(),
                blocked: true,
            } as ChannelContext & { blocked?: boolean };
        }

        const ctx: ChannelContext = {
            received: hookResult.message,
            sendMessage: {
                text: '',
                mediaFiles: [],
            } as ChannelSendMessage,
            createdAt: Date.now(),
            send,
        };

        if (this.middlewares.length === 0) {
            logger.warn({}, 'Warning: No middleware registered, returning empty response');
            return ctx;
        }

        // 阶段 2：中间件链执行
        let index = 0;

        const next: () => Promise<void> = async () => {
            if (index < this.middlewares.length) {
                const currentMiddleware = this.middlewares[index++];
                logger.debug(
                    {
                        middlewareIndex: index - 1,
                        remaining: this.middlewares.length - index,
                    },
                    `Executing middleware ${index}/${this.middlewares.length}`,
                );
                await currentMiddleware(ctx, next);
            } else {
                logger.debug({}, 'Middleware chain completed');
            }
        };

        try {
            await next();

            // 阶段 3：onSend 钩子 — 插件可修改或阻止回复
            const processedSendMessage = await this.hookRuntime.dispatchSend({
                message: {
                    chatId: ctx.received.chatId,
                    text: ctx.sendMessage?.text,
                    mediaFiles: ctx.sendMessage?.mediaFiles,
                    error: ctx.sendMessage?.error,
                },
            });

            if (processedSendMessage.blocked) {
                logger.info(
                    { chatId: ctx.received.chatId, reason: processedSendMessage.reason },
                    'Send message blocked by plugin',
                );
                ctx.sendMessage.text = '';
                ctx.sendMessage.mediaFiles = [];
                return ctx;
            }

            ctx.sendMessage.text = processedSendMessage.message.text;
            ctx.sendMessage.mediaFiles = processedSendMessage.message.mediaFiles;
            ctx.sendMessage.error = processedSendMessage.message.error;

            // 阶段 4：通过 send 回调发送到频道
            if (ctx.send && ctx.sendMessage?.text) {
                await ctx.send({
                    text: ctx.sendMessage.text,
                    mediaFiles: ctx.sendMessage.mediaFiles,
                });
                logger.debug({ chatId: ctx.received.chatId }, 'Response sent via channel send');
            }

            const duration = Date.now() - startTime;
            const sendText = ctx.sendMessage?.text ?? '';
            const sendLength = sendText.length;
            logger.info(
                { chatId: ctx.received.chatId, duration, sendLength },
                'Message processing completed, returning response',
            );
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = toErrorMessage(error);
            const errorStack = error instanceof Error ? error.stack : undefined;
            logger.error(
                {
                    chatId: ctx.received.chatId,
                    duration,
                    error: errorMessage,
                    stack: errorStack,
                },
                'Error during message processing',
            );
            if (!ctx.sendMessage) {
                ctx.sendMessage = { text: '', mediaFiles: [] };
            }
            ctx.sendMessage.text = 'Internal system error, please try again later';
            ctx.sendMessage.error = errorMessage;

            // 错误时也尝试通过 send 发送错误回复
            if (ctx.send && ctx.sendMessage?.text) {
                await ctx.send({
                    text: ctx.sendMessage.text,
                    mediaFiles: ctx.sendMessage.mediaFiles ?? [],
                });
            }
        }

        return ctx;
    }
}
