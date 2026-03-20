import type { Express } from 'express';
import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Config, MCPServerInfo } from '../../types.js';
import { ConfigLoader } from '../../config/loader.js';
import { getConfigValidationIssue, parseMCPServerConfig } from '../../config/index.js';
import { connectMcpServer, disconnectMcpServer, reconnectMcpServer } from '../../mcp/runtime.js';
import { formatLocalTimestamp } from '../../observability/logging.js';
import { badRequest, notFound, serverError } from './helpers.js';

interface MCPDeps {
  toolRegistry?: ToolRegistry;
  getConfig: () => Config;
  setConfig?: (config: Config) => void;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (m: MCPClientManager) => void;
}

type SerializedMcpServer = MCPServerInfo;

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

export function resolveConfiguredMcpServer(
  config: Config,
  manager: MCPClientManager | undefined,
  name: string
): SerializedMcpServer | null {
  const configuredServer = config.mcp[name];
  if (!configuredServer) {
    return null;
  }

  const runtimeServer = manager?.getServerStatus(name);
  if (runtimeServer && !Array.isArray(runtimeServer) && runtimeServer.status !== 'disconnected') {
    return {
      ...runtimeServer,
      config: configuredServer
    };
  }

  return {
    name,
    status: 'disconnected',
    config: configuredServer,
    toolCount: 0
  };
}

export function listConfiguredMcpServers(
  config: Config,
  manager: MCPClientManager | undefined
): SerializedMcpServer[] {
  return Object.keys(config.mcp)
    .map((name) => resolveConfiguredMcpServer(config, manager, name))
    .filter((server): server is SerializedMcpServer => server !== null);
}

export function registerMCPRoutes(app: Express, deps: MCPDeps): void {
  app.get('/api/mcp/servers', (req, res) => {
    res.json({
      servers: serializeServerStatus(listConfiguredMcpServers(deps.getConfig(), deps.getMcpManager()))
    });
  });

  app.get('/api/mcp/servers/:name', (req, res) => {
    const { name } = req.params;
    const server = resolveConfiguredMcpServer(deps.getConfig(), deps.getMcpManager(), name);
    if (!server) {
      return notFound(res, 'MCP server', name);
    }

    const tools = server.status === 'disconnected'
      ? []
      : deps.getMcpManager()?.getToolsForServer(name) ?? [];
    res.json({ server: serializeServerStatus(server), tools });
  });

  app.post('/api/mcp/servers/:name', async (req, res) => {
    try {
      const { name } = req.params;
      const config = parseMCPServerConfig(req.body);

      const { manager, toolsRegistered } = await connectMcpServer({
        getMcpManager: deps.getMcpManager,
        setMcpManager: deps.setMcpManager,
        toolRegistry: deps.toolRegistry
      }, name, config);

      const nextConfig = await ConfigLoader.update((currentConfig) => {
        currentConfig.mcp[name] = config;
      });
      deps.setConfig?.(nextConfig);

      res.status(201).json({
        success: true,
        server: serializeServerStatus(resolveConfiguredMcpServer(nextConfig, manager, name)),
        toolsRegistered
      });
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
      if (deps.getConfig().mcp[name]) {
        const nextConfig = await ConfigLoader.update((currentConfig) => {
          delete currentConfig.mcp[name];
        });
        deps.setConfig?.(nextConfig);
      }

      const { toolsRemoved } = await disconnectMcpServer({
        getMcpManager: deps.getMcpManager,
        setMcpManager: deps.setMcpManager,
        toolRegistry: deps.toolRegistry
      }, name);

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
      const { manager } = await reconnectMcpServer({
        getMcpManager: deps.getMcpManager,
        setMcpManager: deps.setMcpManager,
        toolRegistry: deps.toolRegistry
      }, name);
      res.json({ success: true, server: serializeServerStatus(manager.getServerStatus(name)) });
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

      let server = deps.getMcpManager()?.getServerStatus(name);
      if (enabled) {
        const { manager } = await connectMcpServer({
          getMcpManager: deps.getMcpManager,
          setMcpManager: deps.setMcpManager,
          toolRegistry: deps.toolRegistry
        }, name, nextConfig.mcp[name]);
        server = manager.getServerStatus(name);
      } else {
        const result = await disconnectMcpServer({
          getMcpManager: deps.getMcpManager,
          setMcpManager: deps.setMcpManager,
          toolRegistry: deps.toolRegistry
        }, name);
        server = result.manager?.getServerStatus(name) || deps.getMcpManager()?.getServerStatus(name);
      }

      res.json({
        success: true,
        enabled,
        server: serializeServerStatus(resolveConfiguredMcpServer(nextConfig, deps.getMcpManager(), name) ?? server)
      });
    } catch (error) {
      serverError(res, error);
    }
  });
}
