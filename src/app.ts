/** Application — 主协调器，拥有所有子系统管理器实例。 */

import { LlmAdapter } from './agent/llm-adapter';
import { SessionManager } from './agent/session/manager';
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
import { WebUiManager } from './web/webui-manager';

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
  private readonly webUiManager: WebUiManager;
  private readonly coreLifecycle: CoreLifecycle;
  private started = false;

  constructor() {
    this.configManager = new ConfigManager();
    this.databaseManager = new DatabaseManager();
    this.skillManager = new SkillManager();
    this.roleManager = new RoleManager();
    this.toolRegistry = new ToolRegistry();
    this.commandRegistry = new CommandRegistry();
    this.llmAdapter = new LlmAdapter(this.configManager);
    this.pipeline = new Pipeline();
    this.sessionManager = new SessionManager(this.databaseManager);
    this.cronManager = new CronManager();
    this.mcpManager = new McpManager(
      this.configManager,
      this.toolRegistry,
      new SdkMcpClientFactory(),
    );
    this.webUiManager = new WebUiManager();
    this.coreLifecycle = new CoreLifecycle();
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('应用已启动');
      return;
    }

    this.coreLifecycle.initialize({
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
      webUiManager: this.webUiManager,
    });

    await this.coreLifecycle.start();

    this.started = true;
  }

  async shutdown(): Promise<void> {
    await this.coreLifecycle.stop();
    this.started = false;
  }
}
