/** Application — 主协调器，拥有所有子系统管理器实例。 */

import { LlmAdapter } from './agent/llm-adapter';
import { SessionManager } from './session/manager';
import { CommandRegistry } from './command/command-registry';
import { ConfigManager } from './core/config/config-manager';
import { CoreLifecycle } from './core/core-lifecycle';
import { DatabaseManager } from './core/database/database-manager';
import { createScopedLogger } from './core/logger';
import { CronManager } from './cron/cron-manager';
import { McpManager } from './mcp/mcp-manager';
import { SdkMcpClientFactory } from './mcp/sdk-mcp-client';
import { Pipeline } from './pipeline/pipeline';
import { RoleManager } from './role/role-manager';
import { SkillManager } from './skill/skill-manager';
import { ToolRegistry } from './tool/tool-registry';

const logger = createScopedLogger('app');

export class Application {
  private readonly configManager: ConfigManager;
  private readonly databaseManager: DatabaseManager;
  private readonly skillManager: SkillManager;
  private readonly roleManager: RoleManager;
  private readonly toolRegistry: ToolRegistry;
  private readonly commandRegistry: CommandRegistry;
  private readonly llmAdapter: LlmAdapter;
  private readonly pipeline: Pipeline;
  private readonly sessionManager: SessionManager;
  private readonly cronManager: CronManager;
  private readonly mcpManager: McpManager;
  private readonly coreLifecycle: CoreLifecycle;
  private started = false;

  constructor() {
    this.configManager = new ConfigManager();
    this.databaseManager = new DatabaseManager();
    this.skillManager = new SkillManager();
    this.roleManager = new RoleManager(this.configManager);
    this.toolRegistry = new ToolRegistry();
    this.commandRegistry = new CommandRegistry();
    this.llmAdapter = new LlmAdapter(this.configManager);
    this.sessionManager = new SessionManager(this.databaseManager);
    this.pipeline = new Pipeline({
      sessionManager: this.sessionManager,
      commandRegistry: this.commandRegistry,
      roleManager: this.roleManager,
      databaseManager: this.databaseManager,
      llmAdapter: this.llmAdapter,
      skillManager: this.skillManager,
      toolRegistry: this.toolRegistry,
      compressionThreshold: this.configManager.get(
        'agent.memory.compressionThreshold',
      ) as number,
    });
    this.cronManager = new CronManager();
    this.mcpManager = new McpManager(
      this.configManager,
      this.toolRegistry,
      new SdkMcpClientFactory(),
    );
    this.coreLifecycle = new CoreLifecycle({
      configManager: this.configManager,
      databaseManager: this.databaseManager,
      skillManager: this.skillManager,
      roleManager: this.roleManager,
      toolRegistry: this.toolRegistry,
      commandRegistry: this.commandRegistry,
      llmAdapter: this.llmAdapter,
      sessionManager: this.sessionManager,
      pipeline: this.pipeline,
      cronManager: this.cronManager,
      mcpManager: this.mcpManager,
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
