import { z } from 'zod';
import { logger } from '@/platform/observability/logger.js';
import type { Tool, ToolDefinition, ToolExecuteContext, ToolExecutionResult } from '@/platform/tools/types.js';
import { zodToToolParameters } from '@/platform/tools/types.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import { cronService } from './cron-service.js';

const CreateCronSchema = z.object({
  name: z.string().min(1, '任务名称不能为空').describe('cron 任务名称'),
  cron_expression: z.string().min(1, 'cron 表达式不能为空').describe('5 段 cron 表达式，例如 */2 * * * * 或 0 */2 * * *'),
  prompt: z.string().min(1, 'prompt 不能为空').describe('到点后交给 agent 执行的提示词'),
});

const ListCronSchema = z.object({});

const DeleteCronSchema = z.object({
  id: z.string().min(1, '任务 id 不能为空').describe('要删除的 cron 任务 id'),
});

class CreateCronTool implements Tool {
  readonly name = 'create_cron';
  readonly description = '创建一个新的 cron 定时任务。支持标准 5 段表达式以及 */2 这类步长语法，例如 */2 * * * * 表示每 2 分钟执行一次，0 */2 * * * 表示每 2 小时执行一次。';
  readonly parametersSchema = CreateCronSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = this.parametersSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        content: '',
        error: `参数验证失败: ${parsed.error.message}`,
      };
    }

    try {
      const job = cronService.createJob({
        name: parsed.data.name.trim(),
        cronExpression: parsed.data.cron_expression.trim(),
        prompt: parsed.data.prompt.trim(),
      });

      logger.info({ jobId: job.id, cronExpression: job.cronExpression }, 'Cron job created via tool');

      return {
        success: true,
        content: [
          'Cron created successfully.',
          `id: ${job.id}`,
          `name: ${job.name}`,
          `expression: ${job.cronExpression}`,
          `enabled: ${job.enabled}`,
          `next_run_at: ${job.nextRunAt ?? 'null'}`,
        ].join('\n'),
        metadata: {
          jobId: job.id,
          nextRunAt: job.nextRunAt,
        },
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ error: errorMessage }, 'Failed to create cron job via tool');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }
}

class ListCronTool implements Tool {
  readonly name = 'list_cron';
  readonly description = '列出当前所有 cron 定时任务，包括 id、名称、表达式、启用状态和下次执行时间。';
  readonly parametersSchema = ListCronSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = this.parametersSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        content: '',
        error: `参数验证失败: ${parsed.error.message}`,
      };
    }

    try {
      const jobs = cronService.listJobs();
      if (jobs.length === 0) {
        return {
          success: true,
          content: 'No cron jobs found.',
          metadata: { count: 0 },
        };
      }

      const lines = [`Found ${jobs.length} cron job(s):`];
      for (const job of jobs) {
        lines.push(
          `${job.id} | ${job.name} | ${job.cronExpression} | enabled=${job.enabled} | last=${job.lastRunAt ?? 'null'} | next=${job.nextRunAt ?? 'null'}`
        );
      }

      return {
        success: true,
        content: lines.join('\n'),
        metadata: { count: jobs.length },
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ error: errorMessage }, 'Failed to list cron jobs via tool');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }
}

class DeleteCronTool implements Tool {
  readonly name = 'delete_cron';
  readonly description = '按 id 删除一个 cron 定时任务。通常先调用 list_cron 获取任务 id，再调用本工具删除。';
  readonly parametersSchema = DeleteCronSchema;

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      parameters: zodToToolParameters(this.parametersSchema),
    };
  }

  async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
    const parsed = this.parametersSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        content: '',
        error: `参数验证失败: ${parsed.error.message}`,
      };
    }

    try {
      const deleted = cronService.deleteJob(parsed.data.id.trim());
      if (!deleted) {
        return {
          success: false,
          content: '',
          error: `Cron job not found: ${parsed.data.id}`,
        };
      }

      logger.info({ jobId: parsed.data.id }, 'Cron job deleted via tool');

      return {
        success: true,
        content: `Cron deleted successfully: ${parsed.data.id}`,
        metadata: { jobId: parsed.data.id },
      };
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      logger.error({ error: errorMessage, jobId: parsed.data.id }, 'Failed to delete cron job via tool');
      return {
        success: false,
        content: '',
        error: errorMessage,
      };
    }
  }
}

export const cronTools: Tool[] = [
  new CreateCronTool(),
  new ListCronTool(),
  new DeleteCronTool(),
];
