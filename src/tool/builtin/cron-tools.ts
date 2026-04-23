/**
 * Built-in cron management tools.
 *
 * create_cron, list_cron, delete_cron — all stubs until
 * CronManager is implemented.
 *
 * @see project.md §5.15
 */

import { Type, Static } from '@sinclair/typebox';
import type { AesyClawTool, ToolExecutionContext, ToolExecutionResult } from '../tool-registry';
import type { ToolOwner } from '../../core/types';

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

/** Dependencies needed by cron tools (typed as unknown until CronManager is implemented) */
export interface CronToolsDeps {
  /** Will be CronManager when implemented */
  cronManager: unknown;
}

// ─── create_cron ───────────────────────────────────────────────────

export function createCreateCronTool(_deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'create_cron',
    description: '创建一个定时任务',
    parameters: CreateCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { scheduleType, prompt } = params as CreateCronParams;
      // Stub — depends on CronManager
      return {
        content: `Cron creation not available (would create ${scheduleType} job: "${prompt.substring(0, 50)}")`,
        isError: true,
      };
    },
  };
}

// ─── list_cron ─────────────────────────────────────────────────────

export function createListCronTool(_deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'list_cron',
    description: '列出所有定时任务',
    parameters: ListCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (_params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      // Stub — depends on CronManager
      return {
        content: 'Cron listing not available — CronManager not yet connected.',
        isError: true,
      };
    },
  };
}

// ─── delete_cron ───────────────────────────────────────────────────

export function createDeleteCronTool(_deps: CronToolsDeps): AesyClawTool {
  return {
    name: 'delete_cron',
    description: '删除指定定时任务',
    parameters: DeleteCronParamsSchema,
    owner: 'system' as ToolOwner,
    execute: async (params: unknown, _context: ToolExecutionContext): Promise<ToolExecutionResult> => {
      const { jobId } = params as DeleteCronParams;
      // Stub — depends on CronManager
      return {
        content: `Cron deletion not available (would delete job: ${jobId})`,
        isError: true,
      };
    },
  };
}