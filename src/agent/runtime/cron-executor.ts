import { SessionMemoryManager } from '@/agent/memory/session-memory-manager.js';
import { resolveLLMConfig } from '@/agent/runtime/resolve-llm-config.js';
import { AgentEngine } from '@/agent/engine.js';
import type { PluginHookRuntime } from '@/contracts/plugin-hook-runtime.js';
import { configManager } from '@/features/config/config-manager.js';
import { roleManager } from '@/features/roles/role-manager.js';
import type { SystemPromptManager } from '@/features/roles/system-prompt-manager.js';
import type { CronExecutor } from '@/features/cron/types.js';
import { MessageRole } from '@/platform/llm/types.js';
import { logger } from '@/platform/observability/logger.js';
import type { ToolCatalog } from '@/platform/tools/registry.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';

export class AgentCronExecutor implements CronExecutor {
  constructor(
    private readonly deps: {
      systemPromptManager: SystemPromptManager;
      toolCatalog: ToolCatalog;
      hookRuntime: PluginHookRuntime;
    }
  ) {}

  async execute(job: CronJob): Promise<void> {
    if (!job.prompt || job.prompt.trim().length === 0) {
      throw new Error('Cron job has no prompt');
    }

    const chatId = `cron-${job.id}`;
    logger.info({ jobId: job.id, chatId }, 'Executing cron job via AgentEngine');

    try {
      const roleConfig = roleManager.getRoleConfig('default');
      const systemPrompt = this.deps.systemPromptManager.buildSystemPrompt({ roleId: 'default', chatId });

      const memory = new SessionMemoryManager(
        chatId,
        {
          maxContextTokens: configManager.config.memory?.max_context_tokens ?? 128000,
          compressionThreshold: configManager.config.memory?.compression_threshold ?? 0.75,
        },
        {
          systemPromptBuilder: this.deps.systemPromptManager,
          roleManager,
          toolCatalog: this.deps.toolCatalog,
        }
      );
      memory.importMemory([{ role: MessageRole.System, content: systemPrompt }]);

      const agent = new AgentEngine(chatId, {
        llm: resolveLLMConfig(roleConfig.model, configManager.config),
        maxSteps: configManager.config.agent?.max_steps ?? 15,
        systemPrompt,
        memory,
        toolCatalog: this.deps.toolCatalog,
        hookRuntime: this.deps.hookRuntime,
      });

      const result = await agent.run(job.prompt);
      if (!result.success) {
        throw new Error(result.error || 'Agent execution failed without error message');
      }

      logger.info(
        {
          jobId: job.id,
          chatId,
          steps: result.steps,
          toolCalls: result.toolCalls,
          responseLength: result.finalText.length,
        },
        'Cron job Agent execution completed successfully'
      );
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ jobId: job.id, chatId, error: errorMessage }, 'Cron job Agent execution failed');
      throw error;
    }
  }
}
