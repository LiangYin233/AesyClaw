import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { ChannelApiService } from './ChannelApiService.js';

export function registerChannelsController(
  app: Express,
  service: ChannelApiService,
  log: { info(message: string, ...args: any[]): void }
): void {
  app.get('/api/channels', (_req, res) => {
    res.json(service.getChannelStatus());
  });

  app.post('/api/channels/:name/send', asyncHandler(async (req, res) => {
    log.info('收到 API 外发消息请求', {
      request_id: req.requestId,
      channel: String(req.params.name),
      chatId: req.body?.chatId
    });
    res.json(await service.sendMessage(String(req.params.name), req.body ?? {}));
  }));
}
