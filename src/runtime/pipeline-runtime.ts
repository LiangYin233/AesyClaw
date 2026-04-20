import { agentStage } from '@/agent/runtime/agent-message-stage.js';
import { ChannelPipeline } from '@/agent/pipeline.js';
import { createSessionStage } from '@/agent/session/session-runtime.js';
import { ChatService } from '@/agent/session/session-service.js';
import type { ConfigManagerService } from '@/contracts/runtime-services.js';
import { createCommandMiddleware } from '@/features/commands/command-middleware.js';
import { CommandManager } from '@/features/commands/command-registry.js';
import { createConfigStage } from '@/features/config/config-message-stage.js';
import { PluginManager } from '@/features/plugins/plugin-manager.js';

interface PipelineRuntimeDependencies {
  pluginManager: PluginManager;
  chatService: ChatService;
  commandManager: CommandManager;
  configManager: ConfigManagerService;
  pipelineRef: { current: ChannelPipeline | null };
}

export class PipelineRuntime {
  constructor(private readonly deps: PipelineRuntimeDependencies) {}

  start(): void {
    const pipeline = new ChannelPipeline(this.deps.pluginManager);
    pipeline.use(createConfigStage({
      isInitialized: () => this.deps.configManager.isInitialized(),
      initialize: () => this.deps.configManager.initialize(),
      getConfig: () => this.deps.configManager.config,
    }));
    pipeline.use(createSessionStage(this.deps.chatService));
    pipeline.use(createCommandMiddleware(this.deps.commandManager));
    pipeline.use(agentStage);
    this.deps.pipelineRef.current = pipeline;
  }

  stop(): void {
    this.deps.pipelineRef.current = null;
  }
}
