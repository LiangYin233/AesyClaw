/**
 * 内置定时任务管理工具。
 *
 * create_cron, list_cron, delete_cron。
 *
 */

import { Type } from '@sinclair/typebox';
import type {
  AesyClawTool,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@aesyclaw/tool/tool-registry';
import type { SessionKey, ToolOwner } from '@aesyclaw/core/types';
import type { CronManager, CreateCronJobParams } from '@aesyclaw/cron/cron-manager';
import { errorMessage } from '@aesyclaw/core/utils';

// ─── create_cron ───────────────────────────────────────────────────

export function createCreateCronTool(deps: {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
}): AesyClawTool {
  return {
    name: 'create_cron',
    description: '创建一个定时任务',
    parameters: Type.Object({
      scheduleType: Type.Union(
        [Type.Literal('once'), Type.Literal('daily'), Type.Literal('interval')],
        { description: '调度类型' },
      ),
      scheduleValue: Type.String({
        description: '调度值（如 "2025-01-01T00:00:00Z"、"08:00"、"30m"）',
      }),
      prompt: Type.String({ description: '定时任务的提示内容' }),
    }),
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const cronParams = params as {
          scheduleType: 'once' | 'daily' | 'interval';
          scheduleValue: string;
          prompt: string;
        };
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

export function createListCronTool(deps: {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
}): AesyClawTool {
  return {
    name: 'list_cron',
    description: '列出当前会话的定时任务',
    parameters: Type.Object({}, { description: '列出当前会话的定时任务（无参数）' }),
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

export function createDeleteCronTool(deps: {
  cronManager: Pick<CronManager, 'createJob' | 'listJobs' | 'deleteJob'>;
}): AesyClawTool {
  return {
    name: 'delete_cron',
    description: '删除指定定时任务',
    parameters: Type.Object({
      jobId: Type.String({ description: '要删除的定时任务 ID' }),
    }),
    owner: 'system' as ToolOwner,
    execute: async (
      params: unknown,
      _context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> => {
      try {
        const { jobId } = params as { jobId: string };
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
