import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ChatApiService } from './ChatApiService.js';
import { parseCreateChatRequest } from './chat.dto.js';

export function registerChatController(
  app: Express,
  service: ChatApiService,
  log: { info(message: string, ...args: any[]): void }
): void {
  app.post('/api/chat', asyncHandler(async (req, res) => {
    const request = parseCreateChatRequest(req.body);
    log.info('收到 API 对话请求', {
      request_id: req.requestId,
      sessionKey: request.sessionKey || 'auto',
      channel: request.channel,
      chatId: request.chatId
    });
    res.json(await service.createChatResponse(request));
  }));
}
