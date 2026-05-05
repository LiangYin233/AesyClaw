/** 用量 Service。 */

import type { WebUiManagerDependencies } from '@aesyclaw/web/webui-manager';
import { createScopedLogger } from '@aesyclaw/core/logger';

const logger = createScopedLogger('webui:usage');

type UsageQuery = {
  model?: string;
  from?: string;
  to?: string;
};

/**
 * 获取用量统计数据。
 */
export async function getUsage(
  deps: WebUiManagerDependencies,
  params?: UsageQuery,
): Promise<unknown> {
  try {
    return await deps.databaseManager.usage.getStats({
      model: params?.model,
      from: params?.from,
      to: params?.to,
    });
  } catch (err) {
    logger.error('获取用量统计失败', err);
    throw new Error('获取用量统计失败', { cause: err });
  }
}

/**
 * 获取今日用量汇总。
 */
export async function getUsageToday(deps: WebUiManagerDependencies): Promise<unknown> {
  try {
    return await deps.databaseManager.usage.getTodaySummary();
  } catch (err) {
    logger.error('获取今日用量汇总失败', err);
    throw new Error('获取今日用量汇总失败', { cause: err });
  }
}

/**
 * 获取工具调用统计数据。
 */
export async function getUsageTools(
  deps: WebUiManagerDependencies,
  params?: { from?: string; to?: string },
): Promise<unknown> {
  try {
    return await deps.databaseManager.toolUsage.getStats({
      from: params?.from,
      to: params?.to,
    });
  } catch (err) {
    logger.error('获取工具调用统计失败', err);
    throw new Error('获取工具调用统计失败', { cause: err });
  }
}
