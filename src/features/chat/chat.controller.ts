import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ChatApiService } from './ChatApiService.js';

export function registerChatController(
  app: Express,
  service: ChatApiService,
  log: { info(message: string, ...args: any[]): void }
): void {
  app.post('/api/chat', asyncHandler(async (req, res) => {
    const { sessionKey, message, channel, chatId } = req.body ?? {};
    log.info('收到 API 对话请求', {
      request_id: req.requestId,
      sessionKey: sessionKey || 'auto',
      channel,
      chatId
    });
    res.json(await service.createChatResponse({ sessionKey, message, channel, chatId }));
  }));
}
