import { LlmAdapter } from './agent/llm-adapter';
import { AgentRegistry } from './agent/agent-registry';
import { SessionManager } from './session/manager';
import { CommandRegistry } from './command/command-registry';
import { ConfigManager } from './core/config/config-manager';
import { RuntimeLifecycle, type RuntimeLifecycleDependencies } from './runtime/lifecycle';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger } from './core/logger';
import { McpManager } from './tool/mcp/mcp-manager';
import { SdkMcpClientFactory } from './tool/mcp/sdk-mcp-client';
import { Pipeline } from './pipeline/pipeline';
import { createAgentFactory } from './agent/agent-factory';
import { createRoleResolver } from './agent/role-resolver';
import { HooksBus } from './hook';
import { RoleManager } from './role/role-manager';
import { RoleStore } from './role/role-store';
import { SkillManager } from './skill/skill-manager';
import { ToolRegistry } from './tool/tool-registry';

const logger = createScopedLogger('app');

function createSubsystems(): RuntimeLifecycleDependencies {
  const agentRegistry = new AgentRegistry();
  const configManager = new ConfigManager();
  const databaseManager = new DatabaseManager();
  const roleStore = new RoleStore(configManager.resolvedPaths.rolesFile);
  const roleManager = new RoleManager(roleStore);
  const skillManager = new SkillManager();
  const toolRegistry = new ToolRegistry();
  const commandRegistry = new CommandRegistry();
  const llmAdapter = new LlmAdapter(configManager);
  const sessionManager = new SessionManager(databaseManager);

  const compressionThreshold = configManager.get('agent.memory.compressionThreshold') as number;
  const hooksBus = new HooksBus();

  const agentFactory = createAgentFactory({
    llmAdapter, roleManager, skillManager, toolRegistry, hooksBus, compressionThreshold,
    agentRegistry,
  });
  const roleResolver = createRoleResolver();

  const pipeline = new Pipeline({
    sessionManager, commandRegistry, roleManager, databaseManager, agentRegistry,
    hooksBus, llmAdapter, compressionThreshold,
    agentFactory, roleResolver,
  });

  const mcpManager = new McpManager(configManager, toolRegistry, new SdkMcpClientFactory());

  return {
    configManager,
    databaseManager,
    roleStore,
    roleManager,
    skillManager,
    toolRegistry,
    commandRegistry,
    llmAdapter,
    sessionManager,
    pipeline,
    mcpManager,
    agentRegistry,
  };
}

/**
 * 应用主类。
 * 负责创建和管理所有子系统，并协调启动/关闭生命周期。
 */
export class Application {
  private readonly runtimeLifecycle: RuntimeLifecycle;
  private started = false;

  constructor() {
    const subsystems = createSubsystems();

    this.runtimeLifecycle = new RuntimeLifecycle({
      configManager: subsystems.configManager,
      databaseManager: subsystems.databaseManager,
      roleStore: subsystems.roleStore,
      roleManager: subsystems.roleManager,
      skillManager: subsystems.skillManager,
      toolRegistry: subsystems.toolRegistry,
      commandRegistry: subsystems.commandRegistry,
      llmAdapter: subsystems.llmAdapter,
      sessionManager: subsystems.sessionManager,
      pipeline: subsystems.pipeline,
      mcpManager: subsystems.mcpManager,
      agentRegistry: subsystems.agentRegistry,
    });
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('应用已启动');
      return;
    }

    await this.runtimeLifecycle.start();

    this.started = true;
  }

  async shutdown(): Promise<void> {
    await this.runtimeLifecycle.stop();
    this.started = false;
  }
}
