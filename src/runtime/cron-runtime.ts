import { AgentCronExecutor } from '@/agent/runtime/cron-executor.js';
import type {
  ConfigManagerService,
  CronServiceRuntime,
  RoleManagerService,
  SkillManagerService,
} from '@/contracts/runtime-services.js';
import { logger } from '@/platform/observability/logger.js';
import type { ToolManager } from '@/platform/tools/registry.js';
import type { PluginManager } from '@/features/plugins/plugin-manager.js';
import type { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';

interface CronRuntimeDependencies {
  cronService: CronServiceRuntime;
  systemPromptManager: SystemPromptManager;
  toolManager: ToolManager;
  pluginManager: PluginManager;
  configManager: ConfigManagerService;
  roleManager: RoleManagerService;
  skillManager: SkillManagerService;
}

export class CronRuntime {
  constructor(private readonly deps: CronRuntimeDependencies) {}

  start(): void {
    this.deps.cronService.setExecutor(new AgentCronExecutor({
      systemPromptManager: this.deps.systemPromptManager,
      toolCatalog: this.deps.toolManager,
      hookRuntime: this.deps.pluginManager,
      configSource: {
        getConfig: () => this.deps.configManager.config,
      },
      roleStore: this.deps.roleManager,
      skillStore: this.deps.skillManager,
    }));
    this.deps.cronService.start();
    logger.info({ schedulerRunning: this.isRunning() }, 'Cron system initialized');
  }

  async stop(): Promise<void> {
    await this.deps.cronService.stop();
  }

  isRunning(): boolean {
    return this.deps.cronService.isRunning();
  }

  getScheduledTaskCount(): number {
    return this.deps.cronService.getScheduledTaskCount();
  }
}
