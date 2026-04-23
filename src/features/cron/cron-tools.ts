import { Type } from '@sinclair/typebox';
import { logger } from '@/platform/observability/logger.js';
import type {
    Tool,
    ToolDefinition,
    ToolExecuteContext,
    ToolExecutionResult,
} from '@/platform/tools/types.js';
import { typeboxToToolParameters, validateToolArgs } from '@/platform/tools/types.js';
import { toErrorMessage } from '@/platform/utils/errors.js';
import type { CronJob } from '@/platform/db/repositories/cron-job-repository.js';
import { cronService } from './cron-service.js';

const CreateCronSchema = Type.Object({
    name: Type.String({ minLength: 1, description: '调度任务名称' }),
    prompt: Type.String({ minLength: 1, description: '到点后交给 agent 执行的提示词' }),
    schedule_type: Type.Union(
        [Type.Literal('once'), Type.Literal('daily'), Type.Literal('interval')],
        { description: '调度类型：once、daily 或 interval' },
    ),
    run_at: Type.Optional(
        Type.String({
            minLength: 1,
            description: '仅 once 可用。未来时间的 ISO 时间字符串，例如 2026-04-20T15:30:00+08:00',
        }),
    ),
    delay_minutes: Type.Optional(
        Type.Integer({
            exclusiveMinimum: 0,
            description: '仅 once 可用。多少分钟后执行，传入后会立即转换为一次性任务',
        }),
    ),
    daily_time: Type.Optional(
        Type.String({
            pattern: '^\\d{2}:\\d{2}$',
            description: '仅 daily 可用。系统本地时区的 HH:MM，例如 09:30',
        }),
    ),
    interval_minutes: Type.Optional(
        Type.Integer({
            exclusiveMinimum: 0,
            description: '仅 interval 可用。按固定节拍每隔多少分钟执行一次',
        }),
    ),
});

const ListCronSchema = Type.Object({});

const DeleteCronSchema = Type.Object({
    id: Type.String({ minLength: 1, description: '要删除的 cron 任务 id' }),
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
            parameters: typeboxToToolParameters(this.parametersSchema),
        };
    }

    async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
        const parsed = validateToolArgs<{
            name: string;
            prompt: string;
            schedule_type: 'once' | 'daily' | 'interval';
            run_at?: string;
            delay_minutes?: number;
            daily_time?: string;
            interval_minutes?: number;
        }>(this.parametersSchema, args);
        if (!parsed.success) {
            return {
                success: false,
                content: '',
                error: parsed.error,
            };
        }

        const data = parsed.data;

        // 手动校验跨字段约束
        const validationError = this.validateScheduleFields(data);
        if (validationError) {
            return {
                success: false,
                content: '',
                error: validationError,
            };
        }

        try {
            const job = cronService.createJob(this.buildCreateInput(data));

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

    private validateScheduleFields(data: {
        schedule_type: string;
        run_at?: string;
        delay_minutes?: number;
        daily_time?: string;
        interval_minutes?: number;
    }): string | null {
        if (data.schedule_type === 'once') {
            const onceFieldCount =
                Number(Boolean(data.run_at)) + Number(data.delay_minutes !== undefined);
            if (onceFieldCount !== 1) {
                return 'once 任务必须且只能提供 run_at 或 delay_minutes 其中一个';
            }
            if (data.daily_time !== undefined || data.interval_minutes !== undefined) {
                return 'once 任务不能提供 daily_time 或 interval_minutes';
            }
            return null;
        }

        if (data.schedule_type === 'daily') {
            if (!data.daily_time) {
                return 'daily 任务必须提供 daily_time';
            }
            if (
                data.run_at !== undefined ||
                data.delay_minutes !== undefined ||
                data.interval_minutes !== undefined
            ) {
                return 'daily 任务只能提供 daily_time';
            }
            return null;
        }

        if (data.schedule_type === 'interval') {
            if (data.interval_minutes === undefined) {
                return 'interval 任务必须提供 interval_minutes';
            }
            if (
                data.run_at !== undefined ||
                data.delay_minutes !== undefined ||
                data.daily_time !== undefined
            ) {
                return 'interval 任务只能提供 interval_minutes';
            }
            return null;
        }

        return null;
    }

    private buildCreateInput(input: {
        name: string;
        prompt: string;
        schedule_type: 'once' | 'daily' | 'interval';
        run_at?: string;
        delay_minutes?: number;
        daily_time?: string;
        interval_minutes?: number;
    }) {
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
            parameters: typeboxToToolParameters(this.parametersSchema),
        };
    }

    async execute(_args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
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
            parameters: typeboxToToolParameters(this.parametersSchema),
        };
    }

    async execute(args: unknown, _context: ToolExecuteContext): Promise<ToolExecutionResult> {
        const parsed = validateToolArgs<{ id: string }>(this.parametersSchema, args);
        if (!parsed.success) {
            return {
                success: false,
                content: '',
                error: parsed.error,
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
