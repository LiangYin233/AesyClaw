import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { Config, MCPServerInfo } from '../../types.js';
import { formatLocalTimestamp } from '../../observability/logging.js';
import { NotFoundError } from '../../api/errors.js';
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

  async createServer(name: string, config: Config['mcp'][string]): Promise<{ success: true; server: unknown; toolsRegistered: number }> {
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

  async toggleServer(name: string, enabled: boolean): Promise<{ success: true; enabled: boolean; server: unknown }> {
    const currentConfig = this.mcpRepository.getConfig();
    if (!currentConfig.mcp[name]) {
      throw new NotFoundError('MCP server in config', name);
    }

    const nextConfig = await this.mcpRepository.saveConfig((config) => {
      config.mcp[name].enabled = enabled;
    });

    let server = this.mcpRepository.getManager()?.getServerStatus(name);
    if (enabled) {
      const { manager } = await this.mcpRepository.connectServer(name, nextConfig.mcp[name]);
      server = manager.getServerStatus(name);
    } else {
      const result = await this.mcpRepository.disconnectServer(name);
      server = result.manager?.getServerStatus(name) || this.mcpRepository.getManager()?.getServerStatus(name);
    }

    return {
      success: true,
      enabled,
      server: serializeServerStatus(this.resolveConfiguredServer(nextConfig, this.mcpRepository.getManager(), name) ?? server)
    };
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
