import { McpApiService } from './McpApiService.js';
import { McpRepository } from './McpRepository.js';
import { registerMcpController } from './mcp.controller.js';
import type { ApiFeatureControllerDeps } from '../featureDeps.js';

export function registerMcpFeature(deps: ApiFeatureControllerDeps): void {
  registerMcpController(
    deps.app,
    new McpApiService(new McpRepository({
      toolRegistry: deps.toolRegistry,
      getConfig: deps.getConfig,
      updateConfig: deps.updateConfig,
      getMcpManager: deps.getMcpManager,
      setMcpManager: deps.setMcpManager
    }))
  );
}
