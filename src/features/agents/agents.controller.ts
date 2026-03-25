import type { Express } from 'express';
import { asyncHandler } from '../../api/middleware/async-handler.js';
import { AgentApiService } from './AgentApiService.js';
import { parseAgentRoleInput } from './agents.dto.js';

export function registerAgentsController(app: Express, service: AgentApiService): void {
  app.get('/api/agents', (_req, res) => {
    res.json(service.listAgents());
  });

  app.post('/api/agents', asyncHandler(async (req, res) => {
    const result = await service.createAgent(parseAgentRoleInput(req.body));
    res.status(201).json(result);
  }));

  app.put('/api/agents/:name', asyncHandler(async (req, res) => {
    const name = String(req.params.name);
    res.json(await service.updateAgent(name, parseAgentRoleInput(req.body, name)));
  }));

  app.delete('/api/agents/:name', asyncHandler(async (req, res) => {
    res.json(await service.deleteAgent(String(req.params.name)));
  }));
}
