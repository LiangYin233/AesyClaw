import { LlmAdapter } from './agent/llm-adapter';
import { AgentRegistry } from './agent/agent-registry';
import { SessionManager } from './session/manager';
import { CommandRegistry } from './command/command-registry';
import { ConfigManager } from './core/config/config-manager';
import { CoreLifecycle } from './core/core-lifecycle';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger } from './core/logger';
import { McpManager } from './mcp/mcp-manager';
import { SdkMcpClientFactory } from './mcp/sdk-mcp-client';
import { Pipeline } from './pipeline/pipeline';
import { RoleManager } from './role/role-manager';
import { RoleStore } from './role/role-store';
import { SkillManager } from './skill/skill-manager';
import { ToolRegistry } from './tool/tool-registry';

const logger = createScopedLogger('app');

type AppSubsystems = {
  configManager: ConfigManager;
  databaseManager: DatabaseManager;
  roleStore: RoleStore;
  roleManager: RoleManager;
  skillManager: SkillManager;
  toolRegistry: ToolRegistry;
  commandRegistry: CommandRegistry;
  llmAdapter: LlmAdapter;
  sessionManager: SessionManager;
  pipeline: Pipeline;
  mcpManager: McpManager;
  agentRegistry: AgentRegistry;
};

function createSubsystems(): AppSubsystems {
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
  const pipeline = new Pipeline({
    sessionManager,
    commandRegistry,
    roleManager,
    databaseManager,
    llmAdapter,
    skillManager,
    toolRegistry,
    compressionThreshold,
    agentRegistry,
  });

  const mcpManager = new McpManager(
    configManager,
    toolRegistry,
    new SdkMcpClientFactory(),
  );

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

export class Application {
  private readonly coreLifecycle: CoreLifecycle;
  private started = false;

  constructor() {
    const subsystems = createSubsystems();

    this.coreLifecycle = new CoreLifecycle({
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

    await this.coreLifecycle.start();

    this.started = true;
  }

  async shutdown(): Promise<void> {
    await this.coreLifecycle.stop();
    this.started = false;
  }
}