/**
 * Built-in cron management tools.
 *
 * create_cron, list_cron, delete_cron.
 *
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { SessionKey, ToolOwner } from '../../core/types';
import type { CronManager, CreateCronJobParams } from '../../cron/cron-manager';

// ─── Parameter schemas ─────────────────────────────────────────────

const CreateCronParamsSchema = Type.Object({
  scheduleType: Type.Union([
    Type.Literal('once'),
    Type.Literal('daily'),
    Type.Literal('interval'),
  ], { description: '调度类型' }),
  scheduleValue: Type.String({ description: '调度值（如 "2025-01-01T00:00:00Z"、"08:00"、"30m"）' }),
  prompt: Type.String({ description: '定时任务的提示内容' }),
});

const ListCronParamsSchema = Type.Object({}, { description: '列出所有定时任务（无参数）' });

const DeleteCronParamsSchema = Type.Object({
  jobId: Type.String({ description: '要删除的定时任务 ID' }),
});

type CreateCronParams = Static<typeof CreateCronParamsSchema>;
type ListCronParams = Static<typeof ListCronParamsSchema>;
type DeleteCronParams = Static<typeof DeleteCronParamsSchema>;

// ─── Dependencies ──────────────────────────────────────────────────

/** Dependencies needed by cron tools. */
export interface CronToolsDeps {
  cronManager: CronManagerLike;
}

type CronManagerLike = Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;

// ─── create_cron ───────────────────────────────────────────────────

export function createCreateCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'create_cron',
    description: '创建一个定时任务',
    parameters: CreateCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      try {
        const cronParams = params as CreateCronParams;
        const sessionKey = requireSessionKey(context.sessionKey);
        const jobId = await deps.cronManager.createJob({
          scheduleType: cronParams.scheduleType,
          scheduleValue: cronParams.scheduleValue,
          prompt: cronParams.prompt,
          sessionKey,
        } satisfies CreateCronJobParams);

        return { content: `Cron job created: ${jobId}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

// ─── list_cron ─────────────────────────────────────────────────────

export function createListCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'list_cron',
    description: '列出所有定时任务',
    parameters: ListCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (_params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      try {
        const jobs = await deps.cronManager.listJobs();
        if (jobs.length === 0) {
          return { content: 'No cron jobs.' };
        }

        const lines = jobs.map((job) => {
          const nextRun = job.nextRun ?? 'not scheduled';
          return `- ${job.id}: ${job.scheduleType} ${job.scheduleValue}, next: ${nextRun}, prompt: ${job.prompt}`;
        });
        return { content: `Cron jobs:\n${lines.join('\n')}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

// ─── delete_cron ───────────────────────────────────────────────────

export function createDeleteCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'delete_cron',
    description: '删除指定定时任务',
    parameters: DeleteCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      try {
        const { jobId } = params as DeleteCronParams;
        const deleted = await deps.cronManager.deleteJob(jobId);
        return { content: deleted ? `Cron job deleted: ${jobId}` : `Cron job not found: ${jobId}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

function requireSessionKey(sessionKey: SessionKey): SessionKey {
  if (!sessionKey.channel || !sessionKey.type || !sessionKey.chatId) {
    throw new Error('Cron tools require a valid session key');
  }
  return sessionKey;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
