/**
 * RoleBindingRepository — role_bindings 表的数据访问层。
 *
 * 存储每个会话的当前激活角色。
 */

import type { DatabaseSync } from 'node:sqlite';

/** 获取会话的当前激活角色 ID。未设置时返回 null。 */
export async function getActiveRoleBinding(
  db: DatabaseSync,
  sessionId: string,
): Promise<string | null> {
  const row = db
    .prepare('SELECT role_id FROM role_bindings WHERE session_id = ?')
    .get(sessionId) as { role_id: string } | undefined;

  return row?.role_id ?? null;
}

/** 设置会话的当前激活角色。使用 INSERT OR REPLACE 保证幂等性。 */
export async function setActiveRoleBinding(
  db: DatabaseSync,
  sessionId: string,
  roleId: string,
): Promise<void> {
  const now = new Date().toISOString();

  db.prepare(
    'INSERT OR REPLACE INTO role_bindings (session_id, role_id, updated_at) VALUES (?, ?, ?)',
  ).run(sessionId, roleId, now);
}
