/**
 * DatabaseManager and Repository function unit tests.
 *
 * These tests use an in-memory SQLite database.
 *
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  findOrCreateSession,
  findSessionByKey,
} from '../../../../src/core/database/repositories/session-repository';
import {
  saveMessage,
  loadMessageHistory,
  clearMessageHistory,
  replaceMessageWithSummary,
} from '../../../../src/core/database/repositories/message-repository';
import {
  getActiveRoleBinding,
  setActiveRoleBinding,
} from '../../../../src/core/database/repositories/role-binding-repository';
import {
  createCronJob,
  findCronJobById,
  findAllCronJobs,
  deleteCronJob,
  updateCronJobNextRun,
  createCronRun,
  markCronRunCompleted,
  markCronRunFailed,
  markCronRunsAbandoned,
  findRunningCronRuns,
} from '../../../../src/core/database/repositories/cron-repository';
import type { SessionKey, PersistableMessage } from '../../../../src/core/types';

// Helper to create an in-memory test database with schema
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      UNIQUE(channel, type, chat_id)
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE role_bindings (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      role_id TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cron_jobs (
      id TEXT PRIMARY KEY,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      prompt TEXT NOT NULL,
      session_key TEXT NOT NULL,
      next_run DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE cron_runs (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES cron_jobs(id),
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    );
  `);

  return db;
}

describe('Database Layer', () => {
  // ─── Session Repository Functions ────────────────────────────────

  describe('SessionRepository', () => {
    let db: DatabaseSync;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => {
      db.close();
    });

    it('should findOrCreate a new session', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user1' };
      const session = await findOrCreateSession(db, key);

      expect(session.channel).toBe('test');
      expect(session.type).toBe('private');
      expect(session.chatId).toBe('user1');
      expect(session.id).toBeDefined();
    });

    it('should return existing session on findOrCreate with same key', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user1' };
      const session1 = await findOrCreateSession(db, key);
      const session2 = await findOrCreateSession(db, key);

      expect(session1.id).toBe(session2.id);
    });

    it('should find a session by key', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user2' };
      await findOrCreateSession(db, key);

      const found = await findSessionByKey(db, key);
      expect(found).not.toBeNull();
      expect(found!.chatId).toBe('user2');
    });

    it('should return null for non-existent session', async () => {
      const result = await findSessionByKey(db, {
        channel: 'nope',
        type: 'private',
        chatId: 'nobody',
      });
      expect(result).toBeNull();
    });
  });

  // ─── Message Repository Functions ────────────────────────────────

  describe('MessageRepository', () => {
    let db: DatabaseSync;
    let sessionId: string;

    beforeEach(async () => {
      db = createTestDb();
      const session = await findOrCreateSession(db, {
        channel: 'msgtest',
        type: 'group',
        chatId: 'room1',
      });
      sessionId = session.id;
    });

    afterEach(() => {
      db.close();
    });

    it('should save and load messages', async () => {
      const userMsg: PersistableMessage = { role: 'user', content: 'Hello' };
      const asstMsg: PersistableMessage = { role: 'assistant', content: 'Hi there' };

      await saveMessage(db, sessionId, userMsg);
      await saveMessage(db, sessionId, asstMsg);

      const history = await loadMessageHistory(db, sessionId);
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('Hi there');
    });

    it('should clear history', async () => {
      await clearMessageHistory(db, sessionId);
      const history = await loadMessageHistory(db, sessionId);
      expect(history.length).toBe(0);
    });

    it('should replace history with summary', async () => {
      await saveMessage(db, sessionId, { role: 'user', content: 'Long conversation...' });
      await saveMessage(db, sessionId, { role: 'assistant', content: 'Response...' });
      await saveMessage(db, sessionId, { role: 'user', content: 'More...' });

      await replaceMessageWithSummary(db, sessionId, 'Summary of conversation');

      const history = await loadMessageHistory(db, sessionId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        role: 'assistant',
        content: 'Summary of conversation',
      });
    });

    it('should roll back summary replacement when insert fails', async () => {
      const failingSession = await findOrCreateSession(db, {
        channel: 'msgtest',
        type: 'group',
        chatId: 'rollback-room',
      });

      await saveMessage(db, failingSession.id, { role: 'user', content: 'Original question' });
      await saveMessage(db, failingSession.id, { role: 'assistant', content: 'Original answer' });

      db.exec(`
        CREATE TRIGGER fail_message_summary_insert
        BEFORE INSERT ON messages
        WHEN NEW.session_id = '${failingSession.id}' AND NEW.content = 'BROKEN_SUMMARY'
        BEGIN
          SELECT RAISE(FAIL, 'summary insert failed');
        END;
      `);

      await expect(
        replaceMessageWithSummary(db, failingSession.id, 'BROKEN_SUMMARY'),
      ).rejects.toThrow('summary insert failed');

      const history = await loadMessageHistory(db, failingSession.id);
      expect(history).toHaveLength(2);
      expect(history.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: 'user', content: 'Original question' },
        { role: 'assistant', content: 'Original answer' },
      ]);
    });
  });

  // ─── RoleBinding Repository Functions ────────────────────────────

  describe('RoleBindingRepository', () => {
    let db: DatabaseSync;
    let sessionId: string;

    beforeEach(async () => {
      db = createTestDb();
      const session = await findOrCreateSession(db, {
        channel: 'roletest',
        type: 'private',
        chatId: 'userrole',
      });
      sessionId = session.id;
    });

    afterEach(() => {
      db.close();
    });

    it('should return null when no role is set', async () => {
      const result = await getActiveRoleBinding(db, sessionId);
      expect(result).toBeNull();
    });

    it('should set and get active role', async () => {
      await setActiveRoleBinding(db, sessionId, 'default');
      const roleId = await getActiveRoleBinding(db, sessionId);
      expect(roleId).toBe('default');
    });

    it('should change active role', async () => {
      await setActiveRoleBinding(db, sessionId, 'researcher');
      const roleId = await getActiveRoleBinding(db, sessionId);
      expect(roleId).toBe('researcher');
    });
  });

  // ─── CronJob Repository Functions ────────────────────────────────

  describe('CronJobRepository', () => {
    let db: DatabaseSync;

    beforeEach(() => {
      db = createTestDb();
    });

    afterEach(() => {
      db.close();
    });

    it('should create a cron job', async () => {
      const key: SessionKey = { channel: 'cron', type: 'private', chatId: 'cronuser' };
      const id = await createCronJob(db, {
        scheduleType: 'daily',
        scheduleValue: '09:00',
        prompt: 'Good morning!',
        sessionKey: key,
        nextRun: new Date('2026-01-01T09:00:00Z'),
      });

      expect(id).toBeDefined();

      const job = await findCronJobById(db, id);
      expect(job).not.toBeNull();
      expect(job!.scheduleType).toBe('daily');
      expect(job!.prompt).toBe('Good morning!');
    });

    it('should list all jobs', async () => {
      const firstId = await createCronJob(db, {
        scheduleType: 'daily',
        scheduleValue: '09:00',
        prompt: 'Morning check',
        sessionKey: { channel: 'cron', type: 'private', chatId: 'list-user-1' },
        nextRun: new Date('2026-01-01T09:00:00Z'),
      });
      const secondId = await createCronJob(db, {
        scheduleType: 'interval',
        scheduleValue: '30',
        prompt: 'Status check',
        sessionKey: { channel: 'cron', type: 'private', chatId: 'list-user-2' },
        nextRun: new Date('2026-01-01T09:30:00Z'),
      });

      const jobs = await findAllCronJobs(db);

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.id)).toEqual([firstId, secondId]);
    });

    it('should delete a job', async () => {
      const key: SessionKey = { channel: 'cron2', type: 'private', chatId: 'cronuser2' };
      const id = await createCronJob(db, {
        scheduleType: 'once',
        scheduleValue: '2026-12-25T00:00:00Z',
        prompt: 'Merry Christmas!',
        sessionKey: key,
        nextRun: new Date('2026-12-25T00:00:00Z'),
      });

      const deleted = await deleteCronJob(db, id);
      expect(deleted).toBe(true);

      const job = await findCronJobById(db, id);
      expect(job).toBeNull();
    });

    it('should delete a job even when cron runs already exist', async () => {
      const key: SessionKey = { channel: 'cron2', type: 'private', chatId: 'cronuser-runs' };
      const id = await createCronJob(db, {
        scheduleType: 'once',
        scheduleValue: '2026-12-25T00:00:00Z',
        prompt: 'Delete me',
        sessionKey: key,
        nextRun: new Date('2026-12-25T00:00:00Z'),
      });
      const runId = await createCronRun(db, { jobId: id });

      const deleted = await deleteCronJob(db, id);

      expect(deleted).toBe(true);
      expect(await findCronJobById(db, id)).toBeNull();
      expect(db.prepare('SELECT id FROM cron_runs WHERE id = ?').get(runId)).toBeUndefined();
    });

    it('should update next_run', async () => {
      const key: SessionKey = { channel: 'cron3', type: 'private', chatId: 'cronuser3' };
      const id = await createCronJob(db, {
        scheduleType: 'interval',
        scheduleValue: '30',
        prompt: 'Check status',
        sessionKey: key,
        nextRun: new Date('2026-06-01T00:00:00Z'),
      });

      const newDate = new Date('2026-06-01T00:30:00Z');
      await updateCronJobNextRun(db, id, newDate);

      const job = await findCronJobById(db, id);
      expect(job!.nextRun).toBe(newDate.toISOString());
    });
  });

  // ─── CronRun Repository Functions ────────────────────────────────

  describe('CronRunRepository', () => {
    let db: DatabaseSync;
    let jobId: string;

    beforeEach(async () => {
      db = createTestDb();

      const key: SessionKey = { channel: 'runtest', type: 'private', chatId: 'runuser' };
      jobId = await createCronJob(db, {
        scheduleType: 'daily',
        scheduleValue: '10:00',
        prompt: 'Daily check',
        sessionKey: key,
        nextRun: new Date('2026-01-01T10:00:00Z'),
      });
    });

    afterEach(() => {
      db.close();
    });

    it('should create a run record', async () => {
      const runId = await createCronRun(db, { jobId });
      expect(runId).toBeDefined();

      const running = await findRunningCronRuns(db);
      expect(running).toHaveLength(1);
      expect(running[0]).toMatchObject({ id: runId, jobId, status: 'running' });
    });

    it('should mark a run as completed', async () => {
      const runId = await createCronRun(db, { jobId });
      await markCronRunCompleted(db, runId, 'Task completed successfully');

      const running = await findRunningCronRuns(db);
      expect(running).toHaveLength(0);

      const completed = db
        .prepare('SELECT status, result, ended_at FROM cron_runs WHERE id = ?')
        .get(runId) as {
        status: string;
        result: string | null;
        ended_at: string | null;
      };

      expect(completed.status).toBe('completed');
      expect(completed.result).toBe('Task completed successfully');
      expect(completed.ended_at).not.toBeNull();
    });

    it('should mark a run as failed', async () => {
      const runId = await createCronRun(db, { jobId });
      await markCronRunFailed(db, runId, 'Something went wrong');

      const failed = db
        .prepare('SELECT status, error, ended_at FROM cron_runs WHERE id = ?')
        .get(runId) as {
        status: string;
        error: string | null;
        ended_at: string | null;
      };

      expect(failed.status).toBe('failed');
      expect(failed.error).toBe('Something went wrong');
      expect(failed.ended_at).not.toBeNull();
    });

    it('should mark runs as abandoned', async () => {
      const runId1 = await createCronRun(db, { jobId });
      const runId2 = await createCronRun(db, { jobId });

      await markCronRunsAbandoned(db, [runId1, runId2]);

      const running = await findRunningCronRuns(db);
      expect(running).toHaveLength(0);

      const abandonedRuns = db
        .prepare('SELECT id, status, ended_at FROM cron_runs WHERE id IN (?, ?) ORDER BY id ASC')
        .all(runId1, runId2) as Array<{ id: string; status: string; ended_at: string | null }>;

      expect(abandonedRuns).toHaveLength(2);
      expect(abandonedRuns.map((run) => run.id).sort()).toEqual([runId1, runId2].sort());
      expect(
        abandonedRuns.every((run) => run.status === 'abandoned' && run.ended_at !== null),
      ).toBe(true);
    });

    it('should roll back abandoned updates when one run update fails', async () => {
      const runId1 = await createCronRun(db, { jobId });
      const runId2 = await createCronRun(db, { jobId });

      db.exec(`
        CREATE TRIGGER fail_cron_run_abandon_update
        BEFORE UPDATE ON cron_runs
        WHEN NEW.id = '${runId2}' AND NEW.status = 'abandoned'
        BEGIN
          SELECT RAISE(FAIL, 'abandon update failed');
        END;
      `);

      await expect(markCronRunsAbandoned(db, [runId1, runId2])).rejects.toThrow(
        'abandon update failed',
      );

      const run1 = db
        .prepare('SELECT status, ended_at FROM cron_runs WHERE id = ?')
        .get(runId1) as {
        status: string;
        ended_at: string | null;
      };
      const run2 = db
        .prepare('SELECT status, ended_at FROM cron_runs WHERE id = ?')
        .get(runId2) as {
        status: string;
        ended_at: string | null;
      };

      expect(run1).toEqual({ status: 'running', ended_at: null });
      expect(run2).toEqual({ status: 'running', ended_at: null });
    });
  });
});
