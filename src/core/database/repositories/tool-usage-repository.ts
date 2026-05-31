/**
 * ToolUsageRepository — tool_usage 表的数据访问层。
 *
 * 存储每次工具调用和技能加载调用。API 查询按名称 + 类型 + 日期聚合。
 * 所有函数均返回 Promise 以保持一致异步模式。
 */

import type { DatabaseSync } from 'node:sqlite';
import type { ToolUsageRecord, ToolUsageSummary } from '@aesyclaw/core/types';
import { BaseRepository } from './base-repository';

// ─── 行类型辅助函数 ─────────────────────────────────────────────

type ToolUsageRow = {
  id: number;
  name: string;
  type: 'tool' | 'skill';
  timestamp: string;
  date: string;
  count: number;
};

// ─── 仓储类 ─────────────────────────────────────────────────────

class ToolUsageRepositoryImpl extends BaseRepository<ToolUsageRecord, ToolUsageRow> {
  protected getTableName(): string {
    return 'tool_usage';
  }

  protected getPrimaryKey(): string {
    return 'id';
  }

  protected mapRow(row: ToolUsageRow): ToolUsageRecord {
    return {
      name: row['name'],
      type: row['type'],
    };
  }

  protected mapToFields(entity: Partial<ToolUsageRecord>): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    if (entity['name'] !== undefined) fields['name'] = entity['name'];
    if (entity['type'] !== undefined) fields['type'] = entity['type'];
    return fields;
  }

  /**
   * 获取按名称 + 类型 + 日期分组的聚合调用统计，支持可选过滤条件。
   * from / to 参数为本地日期字符串 (YYYY-MM-DD)，过滤和日期输出均基于 SQLite localtime。
   */
  async getToolUsageStats(
    options?: { from?: string; to?: string },
  ): Promise<ToolUsageSummary[]> {
    const fromFilter = options?.from ?? null;
    const toFilter = options?.to ?? null;

    const rows = this.query<ToolUsageRow>(
      `SELECT
        name,
        type,
        DATE(timestamp, 'localtime') as date,
        COUNT(*) as count
      FROM tool_usage
      WHERE (? IS NULL OR DATE(timestamp, 'localtime') >= ?)
        AND (? IS NULL OR DATE(timestamp, 'localtime') <= ?)
      GROUP BY name, type, DATE(timestamp, 'localtime')
      ORDER BY count DESC, name ASC`,
      fromFilter,
      fromFilter,
      toFilter,
      toFilter,
    );

    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      date: row.date,
      count: row.count,
    }));
  }
}

// ─── 公共 API ───────────────────────────────────────────────────

/** 插入单条工具/技能调用记录。返回生成的行 ID。 */
export async function createToolUsageRecord(
  db: DatabaseSync,
  record: ToolUsageRecord,
): Promise<number> {
  const repo = new ToolUsageRepositoryImpl(db);
  const id = await repo.create(record);
  return typeof id === 'number' ? id : Number(id);
}

/** 获取按名称 + 类型 + 日期分组的聚合调用统计，支持可选过滤条件。
 *  from / to 参数为本地日期字符串 (YYYY-MM-DD)，过滤和日期输出均基于 SQLite localtime。 */
export async function getToolUsageStats(
  db: DatabaseSync,
  options?: { from?: string; to?: string },
): Promise<ToolUsageSummary[]> {
  const repo = new ToolUsageRepositoryImpl(db);
  return repo.getToolUsageStats(options);
}
