import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { Config, MCPServerInfo } from '../../types.js';
import { getConfigValidationIssue, parseMCPServerConfig } from '../../config/index.js';
import { formatLocalTimestamp } from '../../observability/logging.js';
import { NotFoundError, ValidationError } from '../../api/errors.js';
import { McpRepository } from './McpRepository.js';

type SerializedMcpServer = MCPServerInfo;

function serializeServerStatus(server: unknown): unknown {
  if (Array.isArray(server)) {
    return server.map((item) => serializeServerStatus(item));
  }
  if (!server || typeof server !== 'object') {
    return server;
  }

  const record = server as Record<string, unknown>;
  return {
    ...record,
    connectedAt: record.connectedAt instanceof Date
      ? formatLocalTimestamp(record.connectedAt)
      : record.connectedAt
  };
}

export class McpApiService {
  constructor(private readonly mcpRepository: McpRepository) {}

  listServers(): { servers: unknown } {
    return {
      servers: serializeServerStatus(this.listConfiguredServers(this.mcpRepository.getConfig(), this.mcpRepository.getManager()))
    };
  }

  getServer(name: string): { server: unknown; tools: unknown[] } {
    const server = this.resolveConfiguredServer(this.mcpRepository.getConfig(), this.mcpRepository.getManager(), name);
    if (!server) {
      throw new NotFoundError('MCP server', name);
    }

    const tools = server.status === 'disconnected'
      ? []
      : this.mcpRepository.getToolsForServer(name);

    return {
      server: serializeServerStatus(server),
      tools
    };
  }

  async createServer(name: string, body: unknown): Promise<{ success: true; server: unknown; toolsRegistered: number }> {
    let config;
    try {
      config = parseMCPServerConfig(body);
    } catch (error) {
      const issue = getConfigValidationIssue(error);
      if (issue) {
        throw new ValidationError(issue.message, issue.field);
      }
      throw error;
    }

    const { manager, toolsRegistered } = await this.mcpRepository.connectServer(name, config);

    const nextConfig = await this.mcpRepository.saveConfig((currentConfig) => {
      currentConfig.mcp[name] = config;
    });

    return {
      success: true,
      server: serializeServerStatus(this.resolveConfiguredServer(nextConfig, manager, name)),
      toolsRegistered
    };
  }

  async deleteServer(name: string): Promise<{ success: true; message: string; toolsRemoved: number }> {
    const manager = this.mcpRepository.getManager();
    if (!manager) {
      throw new NotFoundError('MCP manager', 'mcp');
    }

    if (this.mcpRepository.getConfig().mcp[name]) {
      await this.mcpRepository.saveConfig((currentConfig) => {
        delete currentConfig.mcp[name];
      });
    }

    const { toolsRemoved } = await this.mcpRepository.disconnectServer(name);

    return {
      success: true,
      message: `MCP server "${name}" removed`,
      toolsRemoved
    };
  }

  async reconnectServer(name: string): Promise<{ success: true; server: unknown }> {
    const manager = this.mcpRepository.getManager();
    if (!manager) {
      throw new NotFoundError('MCP manager', 'mcp');
    }

    const result = await this.mcpRepository.reconnectServer(name);

    return {
      success: true,
      server: serializeServerStatus(result.manager.getServerStatus(name))
    };
  }

  async toggleServer(name: string, body: unknown): Promise<{ success: true; enabled: boolean; server: unknown }> {
    const payload = this.requireBody(body);
    if (typeof payload.enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean', 'enabled');
    }

    const currentConfig = this.mcpRepository.getConfig();
    if (!currentConfig.mcp[name]) {
      throw new NotFoundError('MCP server in config', name);
    }

    const nextConfig = await this.mcpRepository.saveConfig((config) => {
      config.mcp[name].enabled = payload.enabled as boolean;
    });

    let server = this.mcpRepository.getManager()?.getServerStatus(name);
    if (payload.enabled) {
      const { manager } = await this.mcpRepository.connectServer(name, nextConfig.mcp[name]);
      server = manager.getServerStatus(name);
    } else {
      const result = await this.mcpRepository.disconnectServer(name);
      server = result.manager?.getServerStatus(name) || this.mcpRepository.getManager()?.getServerStatus(name);
    }

    return {
      success: true,
      enabled: payload.enabled,
      server: serializeServerStatus(this.resolveConfiguredServer(nextConfig, this.mcpRepository.getManager(), name) ?? server)
    };
  }

  private requireBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('request body must be an object');
    }
    return body as Record<string, unknown>;
  }

  private resolveConfiguredServer(
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

  private listConfiguredServers(config: Config, manager: MCPClientManager | undefined): SerializedMcpServer[] {
    return Object.keys(config.mcp)
      .map((name) => this.resolveConfiguredServer(config, manager, name))
      .filter((server): server is SerializedMcpServer => server !== null);
  }
}
