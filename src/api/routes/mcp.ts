import type { Express } from 'express';
import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Config } from '../../types.js';
import { ConfigLoader } from '../../config/loader.js';
import { getConfigValidationIssue, parseMCPServerConfig } from '../../config/index.js';
import { createErrorResponse, createValidationErrorResponse, NotFoundError } from '../../logger/index.js';

interface MCPDeps {
  mcpManager?: MCPClientManager;
  toolRegistry?: ToolRegistry;
  getConfig: () => Config;
  setConfig?: (config: Config) => void;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (m: MCPClientManager) => void;
}

export function registerMCPRoutes(app: Express, deps: MCPDeps): void {
  app.get('/api/mcp/servers', (req, res) => {
    const mgr = deps.getMcpManager();
    if (!mgr) return res.json({ servers: [] });
    res.json({ servers: mgr.getServerStatus() });
  });

  app.get('/api/mcp/servers/:name', (req, res) => {
    const mgr = deps.getMcpManager();
    if (!mgr) return res.status(404).json(createErrorResponse(new NotFoundError('MCP manager', 'mcp')));
    const { name } = req.params;
    const server = mgr.getServerStatus(name);
    if (!server || (Array.isArray(server) ? false : server.status === 'disconnected')) {
      return res.status(404).json(createErrorResponse(new NotFoundError('MCP server', name)));
    }
    const tools = mgr.getToolsForServer(name);
    res.json({ server, tools });
  });

  app.post('/api/mcp/servers/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const config = parseMCPServerConfig(req.body);

      let mgr = deps.getMcpManager();
      if (!mgr) {
        const { MCPClientManager } = await import('../../mcp/index.js');
        mgr = new MCPClientManager();
        deps.setMcpManager(mgr);
      }

      await mgr.connectOne(name, config);

      const nextConfig = await ConfigLoader.update((currentConfig) => {
        currentConfig.mcp[name] = config;
      });
      deps.setConfig?.(nextConfig);

      let toolsRegistered = 0;
      if (deps.toolRegistry) {
        const tools = mgr.getTools().filter(t => t.name.startsWith(`mcp_${name}_`));
        for (const tool of tools) {
          deps.toolRegistry.register({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            execute: async (params: any) => mgr!.callTool(tool.name, params),
            source: 'mcp' as any
          }, 'mcp');
        }
        toolsRegistered = tools.length;
      }

      res.status(201).json({ success: true, server: mgr.getServerStatus(name), toolsRegistered });
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        return res.status(400).json(createValidationErrorResponse(issue.message, issue.field));
      }

      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/mcp/servers/:name', async (req, res) => {
    try {
      const mgr = deps.getMcpManager();
      if (!mgr) return res.status(404).json(createErrorResponse(new NotFoundError('MCP manager', 'mcp')));

      const { name } = req.params;
      await mgr.disconnectOne(name);

      if (deps.getConfig().mcp[name]) {
        const nextConfig = await ConfigLoader.update((currentConfig) => {
          delete currentConfig.mcp[name];
        });
        deps.setConfig?.(nextConfig);
      }

      let toolsRemoved = 0;
      if (deps.toolRegistry) {
        const toRemove = deps.toolRegistry.list().filter((t: any) => t.name.startsWith(`mcp_${name}_`));
        for (const tool of toRemove) deps.toolRegistry.unregister(tool.name);
        toolsRemoved = toRemove.length;
      }

      res.json({ success: true, message: `MCP server "${name}" removed`, toolsRemoved });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/mcp/servers/:name/reconnect', async (req, res) => {
    try {
      const mgr = deps.getMcpManager();
      if (!mgr) return res.status(404).json(createErrorResponse(new NotFoundError('MCP manager', 'mcp')));
      const { name } = req.params;
      await mgr.reconnect(name);
      res.json({ success: true, server: mgr.getServerStatus(name) });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.post('/api/mcp/servers/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json(createValidationErrorResponse('enabled must be a boolean', 'enabled'));
      }
      const currentConfig = deps.getConfig();
      if (!currentConfig.mcp[name]) {
        return res.status(404).json(createErrorResponse(new NotFoundError('MCP server in config', name)));
      }

      const nextConfig = await ConfigLoader.update((config) => {
        config.mcp[name].enabled = enabled;
      });
      deps.setConfig?.(nextConfig);

      const mgr = deps.getMcpManager();
      if (mgr) {
        if (enabled) {
          await mgr.connectOne(name, nextConfig.mcp[name]);
        } else {
          await mgr.disconnectOne(name);
        }
      }

      res.json({ success: true, enabled, server: mgr?.getServerStatus(name) });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });
}
