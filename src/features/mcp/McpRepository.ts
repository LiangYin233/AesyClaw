import type { MCPClientManager } from '../../mcp/MCPClient.js';
import type { ToolRegistry } from '../../tools/ToolRegistry.js';
import type { Config, MCPServerInfo } from '../../types.js';
import { connectMcpServer, disconnectMcpServer, reconnectMcpServer } from '../../mcp/runtime.js';

interface McpRepositoryDeps {
  toolRegistry?: ToolRegistry;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  getMcpManager: () => MCPClientManager | undefined;
  setMcpManager: (manager: MCPClientManager) => void;
}

export class McpRepository {
  constructor(private readonly deps: McpRepositoryDeps) {}

  getConfig(): Config {
    return this.deps.getConfig();
  }

  getManager(): MCPClientManager | undefined {
    return this.deps.getMcpManager();
  }

  getToolsForServer(name: string): unknown[] {
    return this.deps.getMcpManager()?.getToolsForServer(name) ?? [];
  }

  getServerStatus(name?: string): MCPServerInfo | MCPServerInfo[] | undefined {
    return this.deps.getMcpManager()?.getServerStatus(name as string);
  }

  async saveConfig(mutator: (config: Config) => void | Config | Promise<void | Config>): Promise<Config> {
    return this.deps.updateConfig(mutator);
  }

  async connectServer(name: string, config: Config['mcp'][string]) {
    return connectMcpServer({
      getMcpManager: this.deps.getMcpManager,
      setMcpManager: this.deps.setMcpManager,
      toolRegistry: this.deps.toolRegistry
    }, name, config);
  }

  async disconnectServer(name: string) {
    return disconnectMcpServer({
      getMcpManager: this.deps.getMcpManager,
      setMcpManager: this.deps.setMcpManager,
      toolRegistry: this.deps.toolRegistry
    }, name);
  }

  async reconnectServer(name: string) {
    return reconnectMcpServer({
      getMcpManager: this.deps.getMcpManager,
      setMcpManager: this.deps.setMcpManager,
      toolRegistry: this.deps.toolRegistry
    }, name);
  }
}
