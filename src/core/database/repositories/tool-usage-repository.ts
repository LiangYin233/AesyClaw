/**
 * ToolUsageRepository — tool_usage 表的数据访问层。
 *
 * 存储每次工具调用和技能加载调用。API 查询按名称 + 类型 + 日期聚合。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { ToolUsageRecord, ToolUsageSummary } from '../../types';

// ─── 行类型辅助函数 ─────────────────────────────────────────────

type ToolUsageRow = {
  name: string;
  type: 'tool' | 'skill';
  date: string;
  count: number;
}

function mapRow(row: ToolUsageRow): ToolUsageSummary {
  return {
    name: row.name,
    type: row.type,
    date: row.date,
    count: row.count,
  };
}

// ─── 公共 API ───────────────────────────────────────────────────

/** 插入单条工具/技能调用记录。返回生成的行 ID。 */
export async function createToolUsageRecord(
  db: DatabaseSync,
  record: ToolUsageRecord,
): Promise<number> {
  const result = db
    .prepare(
      `INSERT INTO tool_usage (name, type)
       VALUES (?, ?)`,
    )
    .run(record.name, record.type);

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

/** 获取按名称 + 类型 + 日期分组的聚合调用统计，支持可选过滤条件。
 *  from / to 参数视为本地日期；过滤和日期输出均基于本地时区（localtime）。 */
export async function getToolUsageStats(
  db: DatabaseSync,
  options?: { from?: string; to?: string },
): Promise<ToolUsageSummary[]> {
  const fromFilter = options?.from ? localDateToUtc(options.from, false) : null;
  const toFilter = options?.to ? localDateToUtc(options.to, true) : null;

  const rows = db
    .prepare(
      `SELECT
        name,
        type,
        DATE(timestamp, 'localtime') as date,
        COUNT(*) as count
      FROM tool_usage
      WHERE (? IS NULL OR timestamp >= ?)
        AND (? IS NULL OR timestamp <= ?)
      GROUP BY name, type, DATE(timestamp, 'localtime')
      ORDER BY count DESC, name ASC`,
    )
    .all(
      fromFilter,
      fromFilter,
      toFilter,
      toFilter,
    ) as unknown as ToolUsageRow[];

  return rows.map(mapRow);
}
