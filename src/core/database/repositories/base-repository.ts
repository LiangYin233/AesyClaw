/**
 * BaseRepository — 仓储基类，提供通用的 CRUD 操作和事务处理。
 *
 * 所有仓储类都可以继承此基类，以减少重复代码。
 * 子类需要实现抽象方法来提供表特定的配置。
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * 仓储基类的配置接口。
 * 子类需要实现这些方法来提供表特定的配置。
 */
export abstract class BaseRepository<T, TRow = unknown> {
  protected db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /**
   * 获取表名。
   * @returns 表名
   */
  protected abstract getTableName(): string;

  /**
   * 获取主键字段名。
   * @returns 主键字段名
   */
  protected abstract getPrimaryKey(): string;

  /**
   * 将数据库行映射为领域对象。
   * @param row - 数据库行
   * @returns 领域对象
   */
  protected abstract mapRow(row: TRow): T;

  /**
   * 将领域对象映射为数据库字段。
   * @param entity - 领域对象
   * @returns 字段名到值的映射
   */
  protected abstract mapToFields(entity: Partial<T>): Record<string, unknown>;

  /**
   * 按主键查找记录。
   * @param id - 主键值
   * @returns 领域对象，未找到时返回 null
   */
  async findById(id: string | number): Promise<T | null> {
    const tableName = this.getTableName();
    const primaryKey = this.getPrimaryKey();

    const row = this.db
      .prepare(`SELECT * FROM ${tableName} WHERE ${primaryKey} = ?`)
      .get(id) as TRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  /**
   * 查找所有记录。
   * @param orderBy - 可选的排序字段
   * @returns 领域对象数组
   */
  async findAll(orderBy?: string): Promise<T[]> {
    const tableName = this.getTableName();
    const orderClause = orderBy ? ` ORDER BY ${orderBy}` : '';

    const rows = this.db
      .prepare(`SELECT * FROM ${tableName}${orderClause}`)
      .all() as TRow[];

    return rows.map((row) => this.mapRow(row));
  }

  /**
   * 创建新记录。
   * @param entity - 要创建的实体（部分字段）
   * @returns 新记录的主键值
   */
  async create(entity: Partial<T>): Promise<string | number> {
    const tableName = this.getTableName();
    const fields = this.mapToFields(entity);
    const columns = Object.keys(fields);
    const placeholders = columns.map(() => '?').join(', ');
    const values = Object.values(fields) as Array<string | number | null | Uint8Array>;

    const result = this.db
      .prepare(
        `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`,
      )
      .run(...values);

    return typeof result.lastInsertRowid === 'bigint'
      ? Number(result.lastInsertRowid)
      : result.lastInsertRowid;
  }

  /**
   * 更新记录。
   * @param id - 主键值
   * @param entity - 要更新的字段
   * @returns 是否更新了记录
   */
  async update(id: string | number, entity: Partial<T>): Promise<boolean> {
    const tableName = this.getTableName();
    const primaryKey = this.getPrimaryKey();
    const fields = this.mapToFields(entity);
    const columns = Object.keys(fields);
    const setClause = columns.map((col) => `${col} = ?`).join(', ');
    const values = [...Object.values(fields), id] as Array<string | number | null | Uint8Array>;

    const result = this.db
      .prepare(`UPDATE ${tableName} SET ${setClause} WHERE ${primaryKey} = ?`)
      .run(...values);

    return (typeof result.changes === 'bigint' ? Number(result.changes) : result.changes) > 0;
  }

  /**
   * 删除记录。
   * @param id - 主键值
   * @returns 是否删除了记录
   */
  async delete(id: string | number): Promise<boolean> {
    const tableName = this.getTableName();
    const primaryKey = this.getPrimaryKey();

    const result = this.db
      .prepare(`DELETE FROM ${tableName} WHERE ${primaryKey} = ?`)
      .run(id);

    return result.changes > 0;
  }

  /**
   * 在事务中执行操作。
   * @param fn - 要在事务中执行的函数
   * @returns 函数的返回值
   */
  async transaction<R>(fn: () => R): Promise<R> {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 在事务中执行异步操作。
   * @param fn - 要在事务中执行的异步函数
   * @returns 函数的返回值
   */
  async transactionAsync<R>(fn: () => Promise<R>): Promise<R> {
    this.db.exec('BEGIN');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * 执行自定义查询。
   * @param sql - SQL 查询语句
   * @param params - 查询参数
   * @returns 查询结果
   */
  protected query<R = TRow>(sql: string, ...params: Array<string | number | null | Uint8Array>): R[] {
    return this.db.prepare(sql).all(...params) as R[];
  }

  /**
   * 执行自定义查询，返回单行。
   * @param sql - SQL 查询语句
   * @param params - 查询参数
   * @returns 查询结果，未找到时返回 undefined
   */
  protected queryOne<R = TRow>(sql: string, ...params: Array<string | number | null | Uint8Array>): R | undefined {
    return this.db.prepare(sql).get(...params) as R | undefined;
  }

  /**
   * 执行自定义更新/插入/删除语句。
   * @param sql - SQL 语句
   * @param params - 语句参数
   * @returns 执行结果
   */
  protected exec(sql: string, ...params: Array<string | number | null | Uint8Array>): { changes: number; lastInsertRowid: number | bigint } {
    const result = this.db.prepare(sql).run(...params);
    return {
      changes: typeof result.changes === 'bigint' ? Number(result.changes) : result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }
}
