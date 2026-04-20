import { z } from 'zod';
import { logger } from '@/platform/observability/logger.js';
import type {
    Tool,
    ToolDefinition,
    ToolExecuteContext,
    ToolExecutionResult,
} from '@/platform/tools/types.js';
import { zodToToolParameters } from '@/platform/tools/types.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';
import { cronService } from './cron-service.js';

const CreateCronSchema = z
    .object({
        name: z.string().trim().min(1, '任务名称不能为空').describe('调度任务名称'),
        prompt: z
            .string()
            .trim()
            .min(1, 'prompt 不能为空')
            .describe('到点后交给 agent 执行的提示词'),
        schedule_type: z
            .enum(['once', 'daily', 'interval'])
            .describe('调度类型：once、daily 或 interval'),
        run_at: z
            .string()
            .trim()
            .min(1)
            .optional()
            .describe('仅 once 可用。未来时间的 ISO 时间字符串，例如 2026-04-20T15:30:00+08:00'),
        delay_minutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('仅 once 可用。多少分钟后执行，传入后会立即转换为一次性任务'),
        daily_time: z
            .string()
            .trim()
            .regex(/^\d{2}:\d{2}$/)
            .optional()
            .describe('仅 daily 可用。系统本地时区的 HH:MM，例如 09:30'),
        interval_minutes: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('仅 interval 可用。按固定节拍每隔多少分钟执行一次'),
    })
    .superRefine((value, ctx) => {
        if (value.schedule_type === 'once') {
            const onceFieldCount =
                Number(Boolean(value.run_at)) + Number(value.delay_minutes !== undefined);
            if (onceFieldCount !== 1) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'once 任务必须且只能提供 run_at 或 delay_minutes 其中一个',
                });
            }

            if (value.daily_time !== undefined || value.interval_minutes !== undefined) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'once 任务不能提供 daily_time 或 interval_minutes',
                });
            }

            return;
        }

        if (value.schedule_type === 'daily') {
            if (!value.daily_time) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'daily 任务必须提供 daily_time',
                });
            }

            if (
                value.run_at !== undefined ||
                value.delay_minutes !== undefined ||
                value.interval_minutes !== undefined
            ) {
                ctx.addIssue({
                    code: 'custom',
                    message: 'daily 任务只能提供 daily_time',
                });
            }

            return;
        }

        if (value.interval_minutes === undefined) {
            ctx.addIssue({
                code: 'custom',
                message: 'interval 任务必须提供 interval_minutes',
            });
        }

        if (
            value.run_at !== undefined ||
            value.delay_minutes !== undefined ||
            value.daily_time !== undefined
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'interval 任务只能提供 interval_minutes',
            });
        }
    });

const ListCronSchema = z.object({});

const DeleteCronSchema = z.object({
    id: z.string().trim().min(1, '任务 id 不能为空').describe('要删除的 cron 任务 id'),
});

class CreateCronTool implements Tool {
    readonly name = 'create_cron';
    readonly description =
        '创建一个新的调度任务。支持一次性执行、延迟执行、每日固定时间执行和固定节拍间隔执行。';
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
            const job = cronService.createJob(this.buildCreateInput(parsed.data));

            logger.info(
                { jobId: job.id, scheduleType: job.schedule.type },
                'Cron job created via tool',
            );

            return {
                success: true,
                content: [
                    'Cron created successfully.',
                    `id: ${job.id}`,
                    `name: ${job.name}`,
                    `schedule: ${formatSchedule(job)}`,
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

    private buildCreateInput(input: z.infer<typeof CreateCronSchema>) {
        if (input.schedule_type === 'once') {
            return {
                name: input.name,
                prompt: input.prompt,
                schedule: input.run_at
                    ? { type: 'once' as const, runAt: input.run_at }
                    : { type: 'delay' as const, delayMinutes: input.delay_minutes! },
            };
        }

        if (input.schedule_type === 'daily') {
            return {
                name: input.name,
                prompt: input.prompt,
                schedule: { type: 'daily' as const, dailyTime: input.daily_time! },
            };
        }

        return {
            name: input.name,
            prompt: input.prompt,
            schedule: {
                type: 'interval' as const,
                intervalMinutes: input.interval_minutes!,
            },
        };
    }
}

class ListCronTool implements Tool {
    readonly name = 'list_cron';
    readonly description =
        '列出当前所有调度任务，包括 id、名称、调度类型、上次执行时间和下次执行时间。';
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
                    `${job.id} | ${job.name} | ${formatSchedule(job)} | last=${job.lastRunAt ?? 'null'} | next=${job.nextRunAt ?? 'null'}`,
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
    readonly description =
        '按 id 删除一个 cron 定时任务。通常先调用 list_cron 获取任务 id，再调用本工具删除。';
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
            const deleted = cronService.deleteJob(parsed.data.id);
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
            logger.error(
                { error: errorMessage, jobId: parsed.data.id },
                'Failed to delete cron job via tool',
            );
            return {
                success: false,
                content: '',
                error: errorMessage,
            };
        }
    }
}

export const cronTools: Tool[] = [new CreateCronTool(), new ListCronTool(), new DeleteCronTool()];

function formatSchedule(job: CronJob): string {
    if (job.schedule.type === 'once') {
        return 'once';
    }

    if (job.schedule.type === 'daily') {
        return `daily@${padTime(job.schedule.hour)}:${padTime(job.schedule.minute)}`;
    }

    return `interval/${job.schedule.intervalMinutes}m`;
}

function padTime(value: number): string {
    return String(value).padStart(2, '0');
}
