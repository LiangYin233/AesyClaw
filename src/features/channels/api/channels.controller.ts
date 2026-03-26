import type { Express } from 'express';
import { asyncHandler } from '../../../app/api/middleware/async-handler.js';
import { ChannelsService } from '../application/ChannelsService.js';
import { parseSendChannelMessage } from './channels.dto.js';

export function registerChannelsController(
  app: Express,
  service: ChannelsService,
  _log: { info(message: string, ...args: any[]): void }
): void {
  app.get('/api/channels', (_req, res) => {
    res.json(service.getChannelStatus());
  });

  app.post('/api/channels/:name/send', asyncHandler(async (req, res) => {
    const request = parseSendChannelMessage(req.body);
    res.json(await service.sendMessage(String(req.params.name), request));
  }));
}
