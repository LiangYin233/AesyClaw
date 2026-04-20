/** @file Cron 定时任务运行时
 *
 * 将 AgentCronExecutor 注入 CronService 并启动调度器。
 * AgentCronExecutor 负责在定时触发时构建完整的 Agent 运行上下文
 * （系统提示、工具目录、钩子运行时、角色/技能存储），
 * 使定时任务具备与交互消息相同的 Agent 能力。
 */

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

/** Cron 定时任务运行时
 *
 * 设置 Agent 执行器并启动调度器，停止时优雅关闭调度任务。
 */
export class CronRuntime {
  constructor(private readonly deps: CronRuntimeDependencies) {}

  /** 注入 Agent 执行器并启动调度器 */
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

  /** 停止调度器，等待当前执行中的任务完成 */
  async stop(): Promise<void> {
    await this.deps.cronService.stop();
  }

  /** 调度器是否正在运行 */
  isRunning(): boolean {
    return this.deps.cronService.isRunning();
  }

  /** 当前已调度的任务数量 */
  getScheduledTaskCount(): number {
    return this.deps.cronService.getScheduledTaskCount();
  }
}
