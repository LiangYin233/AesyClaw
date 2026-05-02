/**
 * UsageRepository — usage 表的数据访问层。
 *
 * 存储每次 LLM 调用的用量数据。API 查询按模型 + 日期聚合。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { UsageRecord, UsageSummary } from '../../types';

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
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
}

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
    costInput: row.costInput,
    costOutput: row.costOutput,
    costCacheRead: row.costCacheRead,
    costCacheWrite: row.costCacheWrite,
    costTotal: row.costTotal,
  };
}

// ─── 公共 API ───────────────────────────────────────────────────

/** 插入单条用量记录。返回生成的行 ID。 */
export async function createUsageRecord(
  db: DatabaseSync,
  record: UsageRecord,
): Promise<number> {
  const timestamp = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO usage (
        model, provider, api, response_id, timestamp,
        input_tokens, output_tokens, total_tokens,
        cache_read_tokens, cache_write_tokens,
        cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      record.usage.cost.input,
      record.usage.cost.output,
      record.usage.cost.cacheRead,
      record.usage.cost.cacheWrite,
      record.usage.cost.total,
    );

  return Number(result.lastInsertRowid);
}

/** 将本地日期字符串（YYYY-MM-DD）转为 UTC ISO 时间戳。
 *  endOfDay=true 返回当天末尾 23:59:59.999Z，否则返回当天开始 00:00:00.000Z。
 *  JavaScript Date 构造函数用数字参数时以本地时区解释，toISOString() 再转回 UTC。 */
function localDateToUtc(dateStr: string, endOfDay: boolean): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(
    y,
    m - 1,
    d,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ).toISOString();
}

/** 获取按模型 + 日期分组的聚合用量统计，支持可选过滤条件。
 *  from / to 参数视为本地日期；过滤和日期输出均基于本地时区（localtime）。 */
export async function getUsageStats(
  db: DatabaseSync,
  options?: { model?: string; from?: string; to?: string },
): Promise<UsageSummary[]> {
  const modelFilter = options?.model ?? null;
  const fromFilter = options?.from ? localDateToUtc(options.from, false) : null;
  const toFilter = options?.to ? localDateToUtc(options.to, true) : null;

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
        COUNT(*) as count,
        SUM(cost_input) as costInput,
        SUM(cost_output) as costOutput,
        SUM(cost_cache_read) as costCacheRead,
        SUM(cost_cache_write) as costCacheWrite,
        SUM(cost_total) as costTotal
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
        COUNT(*) as count,
        SUM(cost_input) as costInput,
        SUM(cost_output) as costOutput,
        SUM(cost_cache_read) as costCacheRead,
        SUM(cost_cache_write) as costCacheWrite,
        SUM(cost_total) as costTotal
      FROM usage
      WHERE DATE(timestamp, 'localtime') >= DATE('now', 'localtime')
      GROUP BY model
      ORDER BY totalTokens DESC`,
    )
    .all() as unknown as UsageRow[];

  return rows.map(mapRow);
}
