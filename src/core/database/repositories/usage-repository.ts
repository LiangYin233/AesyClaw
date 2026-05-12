/**
 * UsageRepository — usage 表的数据访问层。
 *
 * 存储每次 LLM 调用的用量数据。API 查询按模型 + 日期聚合。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { UsageRecord, UsageSummary } from '@aesyclaw/core/types';
import { localDateToUtcStart, localDateToUtcEnd } from './utils';

// ─── 行类型辅助函数 ─────────────────────────────────────────────

type UsageRow = {
  model: string;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  count: number;
};

function mapRow(row: UsageRow): UsageSummary {
  return {
    model: row.model,
    date: row.date,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    cacheReadTokens: row.cacheReadTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    count: row.count,
  };
}

// ─── 公共 API ───────────────────────────────────────────────────

/** 插入单条用量记录。返回生成的行 ID。 */
export async function createUsageRecord(db: DatabaseSync, record: UsageRecord): Promise<number> {
  const timestamp = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO usage (
        model, provider, api, response_id, timestamp,
        input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.model,
      record.provider,
      record.api,
      record.responseId ?? null,
      timestamp,
      record.usage.input,
      record.usage.output,
      record.usage.totalTokens,
      record.usage.cacheRead,
      record.usage.cacheWrite,
    );

  return Number(result.lastInsertRowid);
}

/** 获取按模型 + 日期分组的聚合用量统计，支持可选过滤条件。
 *  from / to 参数视为本地日期；过滤和日期输出均基于本地时区（localtime）。 */
export async function getUsageStats(
  db: DatabaseSync,
  options?: { model?: string; from?: string; to?: string },
): Promise<UsageSummary[]> {
  const modelFilter = options?.model ?? null;
  const fromFilter = options?.from ? localDateToUtcStart(options.from) : null;
  const toFilter = options?.to ? localDateToUtcEnd(options.to) : null;

  const rows = db
    .prepare(
      `SELECT
        model,
        DATE(timestamp, 'localtime') as date,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(total_tokens) as totalTokens,
        SUM(cache_read_tokens) as cacheReadTokens,
        SUM(cache_write_tokens) as cacheWriteTokens,
        COUNT(*) as count
      FROM usage
      WHERE (? IS NULL OR model = ?)
        AND (? IS NULL OR timestamp >= ?)
        AND (? IS NULL OR timestamp <= ?)
      GROUP BY model, DATE(timestamp, 'localtime')
      ORDER BY date DESC, model ASC`,
    )
    .all(
      modelFilter,
      modelFilter,
      fromFilter,
      fromFilter,
      toFilter,
      toFilter,
    ) as unknown as UsageRow[];

  return rows.map(mapRow);
}

/** 获取今日的聚合用量汇总（仪表板卡片用）。
 *  日期边界使用本地时区：DATE(..., 'localtime') >= DATE('now', 'localtime')。 */
export async function getTodayUsageSummary(db: DatabaseSync): Promise<UsageSummary[]> {
  const rows = db
    .prepare(
      `SELECT
        model,
        DATE(timestamp, 'localtime') as date,
        SUM(input_tokens) as inputTokens,
        SUM(output_tokens) as outputTokens,
        SUM(total_tokens) as totalTokens,
        SUM(cache_read_tokens) as cacheReadTokens,
        SUM(cache_write_tokens) as cacheWriteTokens,
        COUNT(*) as count
      FROM usage
      WHERE DATE(timestamp, 'localtime') >= DATE('now', 'localtime')
      GROUP BY model
      ORDER BY totalTokens DESC`,
    )
    .all() as unknown as UsageRow[];

  return rows.map(mapRow);
}
