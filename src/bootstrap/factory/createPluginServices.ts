import type { OutboundGateway } from '../../agent/index.js';
import { ConfigManager, RuntimeConfigStore } from '../../config/index.js';
import { ToolRegistry } from '../../tools/index.js';
import { createPluginManager } from './PluginRuntimeFactory.js';

export async function createPluginServices(args: {
  configStore: RuntimeConfigStore;
  configManager: ConfigManager;
  outboundGateway: OutboundGateway;
  workspace: string;
  tempDir: string;
  toolRegistry: ToolRegistry;
}) {
  const { configStore, configManager, outboundGateway, workspace, tempDir, toolRegistry } = args;

  return createPluginManager({
    configStore,
    outboundGateway,
    workspace,
    tempDir,
    toolRegistry,
    updateConfig: (mutator) => configManager.update(mutator)
  });
}
