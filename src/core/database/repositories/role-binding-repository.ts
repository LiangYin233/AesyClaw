/**
 * RoleBindingRepository — data access for the role_bindings table.
 *
 * Stores which role is active for each session.
 */

import type { DatabaseSync } from 'node:sqlite';

export class RoleBindingRepository {
  constructor(private db: DatabaseSync) {}

  /** Get the active role ID for a session. Returns null if not set. */
  async getActiveRole(sessionId: string): Promise<string | null> {
    const row = this.db
      .prepare('SELECT role_id FROM role_bindings WHERE session_id = ?')
      .get(sessionId) as { role_id: string } | undefined;

    return row?.role_id ?? null;
  }

  /** Set the active role for a session. Uses INSERT OR REPLACE for idempotency. */
  async setActiveRole(sessionId: string, roleId: string): Promise<void> {
    const now = new Date().toISOString();

    this.db
      .prepare(
        'INSERT OR REPLACE INTO role_bindings (session_id, role_id, updated_at) VALUES (?, ?, ?)',
      )
      .run(sessionId, roleId, now);
  }
}
