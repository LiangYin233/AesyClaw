import type { McpClientManager } from '../index.js';
import type { Config, MCPServerInfo } from '../../../types.js';
import { formatLocalTimestamp } from '../../../platform/observability/logging.js';
import { ResourceNotFoundError } from '../../../platform/errors/domain.js';
import { McpRepository } from '../infrastructure/McpRepository.js';

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

export class McpService {
  constructor(private readonly mcpRepository: McpRepository) {}

  listServers(): { servers: unknown } {
    return {
      servers: serializeServerStatus(this.listConfiguredServers(this.mcpRepository.getConfig(), this.mcpRepository.getManager()))
    };
  }

  getServer(name: string): { server: unknown; tools: unknown[] } {
    const server = this.resolveConfiguredServer(this.mcpRepository.getConfig(), this.mcpRepository.getManager(), name);
    if (!server) {
      throw new ResourceNotFoundError('MCP server', name);
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
    const nextConfig = await this.mcpRepository.saveConfig((currentConfig) => {
      currentConfig.mcp[name] = config;
    });
    const toolsRegistered = this.mcpRepository.getToolsForServer(name).length;

    return {
      success: true,
      server: serializeServerStatus(this.resolveConfiguredServer(nextConfig, this.mcpRepository.getManager(), name)),
      toolsRegistered
    };
  }

  async deleteServer(name: string): Promise<{ success: true; message: string; toolsRemoved: number }> {
    const manager = this.mcpRepository.getManager();
    if (!manager) {
      throw new ResourceNotFoundError('MCP manager', 'mcp');
    }

    const toolsRemoved = this.mcpRepository.getToolsForServer(name).length;
    if (this.mcpRepository.getConfig().mcp[name]) {
      await this.mcpRepository.saveConfig((currentConfig) => {
        delete currentConfig.mcp[name];
      });
    }

    return {
      success: true,
      message: `MCP server "${name}" removed`,
      toolsRemoved
    };
  }

  async reconnectServer(name: string): Promise<{ success: true; server: unknown }> {
    const manager = this.mcpRepository.getManager();
    if (!manager) {
      throw new ResourceNotFoundError('MCP manager', 'mcp');
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
      throw new ResourceNotFoundError('MCP server in config', name);
    }

    const nextConfig = await this.mcpRepository.saveConfig((config) => {
      config.mcp[name].enabled = enabled;
    });

    return {
      success: true,
      enabled,
      server: serializeServerStatus(this.resolveConfiguredServer(nextConfig, this.mcpRepository.getManager(), name))
    };
  }

  private resolveConfiguredServer(
    config: Config,
    manager: McpClientManager | undefined,
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

  private listConfiguredServers(config: Config, manager: McpClientManager | undefined): SerializedMcpServer[] {
    return Object.keys(config.mcp)
      .map((name) => this.resolveConfiguredServer(config, manager, name))
      .filter((server): server is SerializedMcpServer => server !== null);
  }
}
