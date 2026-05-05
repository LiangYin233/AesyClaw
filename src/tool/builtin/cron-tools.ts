/**
 * 内置定时任务管理工具。
 *
 * create_cron, list_cron, delete_cron。
 *
 */

import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import type { SessionKey, ToolOwner } from '@aesyclaw/core/types';
import type { CronManager, CreateCronJobParams } from '@aesyclaw/cron/cron-manager';
import { errorMessage } from '@aesyclaw/core/utils';

// ─── 参数模式 ─────────────────────────────────────────────────────

const CreateCronParamsSchema = Type.Object({
  scheduleType: Type.Union(
    [Type.Literal('once'), Type.Literal('daily'), Type.Literal('interval')],
    { description: '调度类型' },
  ),
  scheduleValue: Type.String({
    description: '调度值（如 "2025-01-01T00:00:00Z"、"08:00"、"30m"）',
  }),
  prompt: Type.String({ description: '定时任务的提示内容' }),
});

const ListCronParamsSchema = Type.Object({}, { description: '列出当前会话的定时任务（无参数）' });

const DeleteCronParamsSchema = Type.Object({
  jobId: Type.String({ description: '要删除的定时任务 ID' }),
});

type CreateCronParams = Static<typeof CreateCronParamsSchema>;
type DeleteCronParams = Static<typeof DeleteCronParamsSchema>;

// ─── 依赖 ─────────────────────────────────────────────────────────

/** 定时任务工具所需的依赖。 */
export type CronToolsDeps = {
  cronManager: CronManagerLike;
};

type CronManagerLike = Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;

// ─── create_cron ───────────────────────────────────────────────────

/**
 * 创建 create_cron 工具定义。
 *
 * @param deps - 包含 cronManager 的依赖项
 * @returns create_cron 工具的 AesyClawTool 定义
 */
export function createCreateCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'create_cron',
    description: '创建一个定时任务',
    parameters: CreateCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const cronParams = params as CreateCronParams;
        const sessionKey = requireSessionKey(context.sessionKey);
        const jobId = await deps.cronManager.createJob({
          scheduleType: cronParams.scheduleType,
          scheduleValue: cronParams.scheduleValue,
          prompt: cronParams.prompt,
          sessionKey,
        } satisfies CreateCronJobParams);

        return { content: `定时任务已创建: ${jobId}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

// ─── list_cron ─────────────────────────────────────────────────────

/**
 * 创建 list_cron 工具定义。
 *
 * @param deps - 包含 cronManager 的依赖项
 * @returns list_cron 工具的 AesyClawTool 定义
 */
export function createListCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'list_cron',
    description: '列出当前会话的定时任务',
    parameters: ListCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      _params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const sessionKey = requireSessionKey(context.sessionKey);
        const jobs = await deps.cronManager.listJobs({ sessionKey });
        if (jobs.length === 0) {
          return { content: '没有定时任务。' };
        }

        const lines = jobs.map((job) => {
          const nextRun = job.nextRun ?? '未调度';
          return `- ${job.id}: ${job.scheduleType} ${job.scheduleValue}, 下次运行: ${nextRun}, 提示: ${job.prompt}`;
        });
        return { content: `定时任务列表:\n${lines.join('\n')}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

// ─── delete_cron ───────────────────────────────────────────────────

/**
 * 创建 delete_cron 工具定义。
 *
 * @param deps - 包含 cronManager 的依赖项
 * @returns delete_cron 工具的 AesyClawTool 定义
 */
export function createDeleteCronTool(deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'delete_cron',
    description: '删除指定定时任务',
    parameters: DeleteCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const { jobId } = params as DeleteCronParams;
        const deleted = await deps.cronManager.deleteJob(jobId);
        return { content: deleted ? `定时任务已删除: ${jobId}` : `定时任务未找到: ${jobId}` };
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
    },
  };
}

function requireSessionKey(sessionKey: SessionKey): SessionKey {
  if (!sessionKey.channel || !sessionKey.type || !sessionKey.chatId) {
    throw new Error('定时任务工具需要有效的会话密钥');
  }
  return sessionKey;
}
