import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { McpApiService } from './McpApiService.js';
import { parseCreateMcpServer, parseToggleMcpServer } from './mcp.dto.js';

export function registerMcpController(app: Express, service: McpApiService): void {
  app.get('/api/mcp/servers', (_req, res) => {
    res.json(service.listServers());
  });

  app.get('/api/mcp/servers/:name', asyncHandler(async (req, res) => {
    res.json(service.getServer(String(req.params.name)));
  }));

  app.post('/api/mcp/servers/:name', asyncHandler(async (req, res) => {
    res.status(201).json(await service.createServer(String(req.params.name), parseCreateMcpServer(req.body)));
  }));

  app.delete('/api/mcp/servers/:name', asyncHandler(async (req, res) => {
    res.json(await service.deleteServer(String(req.params.name)));
  }));

  app.post('/api/mcp/servers/:name/reconnect', asyncHandler(async (req, res) => {
    res.json(await service.reconnectServer(String(req.params.name)));
  }));

  app.post('/api/mcp/servers/:name/toggle', asyncHandler(async (req, res) => {
    res.json(await service.toggleServer(String(req.params.name), parseToggleMcpServer(req.body).enabled));
  }));
}
