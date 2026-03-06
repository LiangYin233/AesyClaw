import type { Express } from 'express';
import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Config } from '../../types.js';
import { ConfigLoader } from '../../config/loader.js';
import { createErrorResponse } from '../../utils/errors.js';

interface MCPDeps {
  mcpManager?: MCPClientManager;
  toolRegistry?: ToolRegistry;
  config: Config;
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
    if (!mgr) return res.status(404).json({ error: 'MCP not configured' });
    const { name } = req.params;
    const server = mgr.getServerStatus(name);
    if (!server || (Array.isArray(server) ? false : server.status === 'disconnected')) {
      return res.status(404).json({ error: `MCP server not found: ${name}` });
    }
    const tools = mgr.getToolsForServer(name);
    res.json({ server, tools });
  });

  app.post('/api/mcp/servers/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const config = req.body;

      if (!config.type || !['local', 'http'].includes(config.type)) {
        return res.status(400).json({ error: 'Invalid config: type must be "local" or "http"' });
      }
      if (config.type === 'local' && !config.command) {
        return res.status(400).json({ error: 'Invalid config: command is required for local type' });
      }
      if (config.type === 'http' && !config.url) {
        return res.status(400).json({ error: 'Invalid config: url is required for http type' });
      }

      let mgr = deps.getMcpManager();
      if (!mgr) {
        const { MCPClientManager } = await import('../../mcp/index.js');
        mgr = new MCPClientManager();
        deps.setMcpManager(mgr);
      }

      await mgr.connectOne(name, config);

      deps.config.mcp = deps.config.mcp || {};
      deps.config.mcp[name] = config;
      await ConfigLoader.save(deps.config);

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

      res.json({ success: true, server: mgr.getServerStatus(name), toolsRegistered });
    } catch (error) {
      res.status(500).json(createErrorResponse(error));
    }
  });

  app.delete('/api/mcp/servers/:name', async (req, res) => {
    try {
      const mgr = deps.getMcpManager();
      if (!mgr) return res.status(404).json({ error: 'MCP not configured' });

      const { name } = req.params;
      await mgr.disconnectOne(name);

      if (deps.config.mcp?.[name]) {
        delete deps.config.mcp[name];
        await ConfigLoader.save(deps.config);
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
      if (!mgr) return res.status(404).json({ error: 'MCP not configured' });
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
        return res.status(400).json({ error: 'Invalid request: enabled must be a boolean' });
      }
      if (!deps.config.mcp?.[name]) {
        return res.status(404).json({ error: `MCP server not found in config: ${name}` });
      }

      deps.config.mcp[name].enabled = enabled;
      await ConfigLoader.save(deps.config);

      const mgr = deps.getMcpManager();
      if (mgr) {
        if (enabled) {
          await mgr.connectOne(name, deps.config.mcp[name]);
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
