import { logger } from '@/platform/observability/logger.js';
import { hasCanonicalValueChanged } from '@/platform/utils/canonical-stringify.js';
import type { ToolManager } from '../registry.js';
import { McpClientManager, type McpServerConnectionConfig } from './mcp-client-manager.js';

export interface McpRuntimeConfigSource {
  getServerConfigs(): readonly McpServerConnectionConfig[];
  onServerConfigChange(
    listener: (
      next: readonly McpServerConnectionConfig[],
      previous: readonly McpServerConnectionConfig[]
    ) => Promise<void>
  ): () => void;
}

interface McpRuntimeDependencies {
  toolManager: ToolManager;
  configSource: McpRuntimeConfigSource;
}

export class McpRuntime {
  private manager: McpClientManager | null = null;
  private configChangeUnsubscribe: (() => void) | null = null;
  private hotReloadEnabled = false;

  constructor(private readonly deps: McpRuntimeDependencies) {}

  getConnectedServers() {
    return this.manager?.getConnectedServers() || [];
  }

  async start(): Promise<void> {
    this.manager = new McpClientManager(this.deps.toolManager);
    await this.manager.connectConfiguredServers(this.deps.configSource.getServerConfigs());
  }

  watchConfigChanges(): void {
    this.registerConfigChangeListener();
  }

  async stop(): Promise<void> {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    if (this.manager) {
      await this.manager.shutdown();
      this.manager = null;
    }
  }

  private registerConfigChangeListener(): void {
    this.configChangeUnsubscribe?.();
    this.configChangeUnsubscribe = null;
    this.hotReloadEnabled = false;

    this.configChangeUnsubscribe = this.deps.configSource.onServerConfigChange(
      async (nextServers, previousServers) => {
        if (!this.hotReloadEnabled || !this.manager) {
          return;
        }
        if (!hasCanonicalValueChanged(previousServers, nextServers)) {
          return;
        }

        logger.info({}, 'MCP config changed, reconnecting MCP servers');
        await this.manager.shutdown();
        await this.manager.connectConfiguredServers(nextServers);
      }
    );

    this.hotReloadEnabled = true;
  }
}
