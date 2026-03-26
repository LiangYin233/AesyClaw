import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { ChatService } from '../application/ChatService.js';
import { parseCreateChatRequest } from './chat.dto.js';

export function registerChatController(
  app: Express,
  service: ChatService,
  _log: { info(message: string, ...args: any[]): void }
): void {
  app.post('/api/chat', asyncHandler(async (req, res) => {
    const request = parseCreateChatRequest(req.body);
    res.json(await service.createChatResponse(request));
  }));
}
