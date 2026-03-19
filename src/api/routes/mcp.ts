import type { Express } from 'express';
import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Config } from '../../types.js';
import { ConfigLoader } from '../../config/loader.js';
import { getConfigValidationIssue, parseMCPServerConfig } from '../../config/index.js';
import { clearMcpServerTools, syncMcpServerTools } from '../../mcp/toolSync.js';
import { formatLocalTimestamp } from '../../observability/logging.js';
import { badRequest, notFound, serverError } from './helpers.js';

interface MCPDeps {
  mcpManager?: MCPClientManager;
  toolRegistry?: ToolRegistry;
  getConfig: () => Config;
  setConfig?: (config: Config) => void;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (m: MCPClientManager) => void;
}

function serializeServerStatus(server: any): any {
  if (Array.isArray(server)) {
    return server.map((item) => serializeServerStatus(item));
  }
  if (!server || typeof server !== 'object') {
    return server;
  }

  return {
    ...server,
    connectedAt: server.connectedAt instanceof Date
      ? formatLocalTimestamp(server.connectedAt)
      : server.connectedAt
  };
}

export function registerMCPRoutes(app: Express, deps: MCPDeps): void {
  app.get('/api/mcp/servers', (req, res) => {
    const mgr = deps.getMcpManager();
    if (!mgr) return res.json({ servers: [] });
    res.json({ servers: serializeServerStatus(mgr.getServerStatus()) });
  });

  app.get('/api/mcp/servers/:name', (req, res) => {
    const mgr = deps.getMcpManager();
    if (!mgr) return notFound(res, 'MCP manager', 'mcp');
    const { name } = req.params;
    const server = mgr.getServerStatus(name);
    if (!server || (Array.isArray(server) ? false : server.status === 'disconnected')) {
      return notFound(res, 'MCP server', name);
    }
    const tools = mgr.getToolsForServer(name);
    res.json({ server: serializeServerStatus(server), tools });
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

      const toolsRegistered = deps.toolRegistry
        ? syncMcpServerTools(deps.toolRegistry, mgr, name)
        : 0;

      res.status(201).json({ success: true, server: serializeServerStatus(mgr.getServerStatus(name)), toolsRegistered });
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        return badRequest(res, issue.message, issue.field);
      }

      serverError(res, error);
    }
  });

  app.delete('/api/mcp/servers/:name', async (req, res) => {
    try {
      const mgr = deps.getMcpManager();
      if (!mgr) return notFound(res, 'MCP manager', 'mcp');

      const { name } = req.params;
      await mgr.disconnectOne(name);

      if (deps.getConfig().mcp[name]) {
        const nextConfig = await ConfigLoader.update((currentConfig) => {
          delete currentConfig.mcp[name];
        });
        deps.setConfig?.(nextConfig);
      }

      const toolsRemoved = deps.toolRegistry
        ? clearMcpServerTools(deps.toolRegistry, name)
        : 0;

      res.json({ success: true, message: `MCP server "${name}" removed`, toolsRemoved });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/mcp/servers/:name/reconnect', async (req, res) => {
    try {
      const mgr = deps.getMcpManager();
      if (!mgr) return notFound(res, 'MCP manager', 'mcp');
      const { name } = req.params;
      await mgr.reconnect(name);
      if (deps.toolRegistry) {
        syncMcpServerTools(deps.toolRegistry, mgr, name);
      }
      res.json({ success: true, server: serializeServerStatus(mgr.getServerStatus(name)) });
    } catch (error) {
      serverError(res, error);
    }
  });

  app.post('/api/mcp/servers/:name/toggle', async (req, res) => {
    try {
      const { name } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return badRequest(res, 'enabled must be a boolean', 'enabled');
      }
      const currentConfig = deps.getConfig();
      if (!currentConfig.mcp[name]) {
        return notFound(res, 'MCP server in config', name);
      }

      const nextConfig = await ConfigLoader.update((config) => {
        config.mcp[name].enabled = enabled;
      });
      deps.setConfig?.(nextConfig);

      const mgr = deps.getMcpManager();
      if (mgr) {
        if (enabled) {
          await mgr.connectOne(name, nextConfig.mcp[name]);
          if (deps.toolRegistry) {
            syncMcpServerTools(deps.toolRegistry, mgr, name);
          }
        } else {
          await mgr.disconnectOne(name);
          if (deps.toolRegistry) {
            clearMcpServerTools(deps.toolRegistry, name);
          }
        }
      }

      res.json({ success: true, enabled, server: serializeServerStatus(mgr?.getServerStatus(name)) });
    } catch (error) {
      serverError(res, error);
    }
  });
}
