import type { Express } from 'express';
import type { McpClientManager } from '../index.js';
import type { ToolRegistry } from '../../../platform/tools/ToolRegistry.js';
import type { Config } from '../../../types.js';
import { registerMcpController } from '../api/mcp.controller.js';
import { McpService } from '../application/McpService.js';
import { McpRepository } from '../infrastructure/McpRepository.js';

export interface McpFeatureDeps {
  app: Express;
  toolRegistry?: ToolRegistry;
  getConfig: () => Config;
  updateConfig: (mutator: (config: Config) => void | Config | Promise<void | Config>) => Promise<Config>;
  getMcpManager: () => McpClientManager | undefined;
  setMcpManager: (manager: McpClientManager) => void;
}

export function registerMcpFeature(deps: McpFeatureDeps): void {
  registerMcpController(
    deps.app,
    new McpService(new McpRepository({
      toolRegistry: deps.toolRegistry,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig,
      getMcpManager: deps.getMcpManager,
      setMcpManager: deps.setMcpManager
    }))
  );
}
