/**
 * DatabaseManager and Repository unit tests.
 *
 * These tests use an in-memory SQLite database.
 *
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SessionRepository } from '../../../../src/core/database/repositories/session-repository';
import { MessageRepository } from '../../../../src/core/database/repositories/message-repository';
import { RoleBindingRepository } from '../../../../src/core/database/repositories/role-binding-repository';
import {
  CronJobRepository,
  CronRunRepository,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
  // ─── SessionRepository ──────────────────────────────────────────

  describe('SessionRepository', () => {
    let db: DatabaseSync;
    let repo: SessionRepository;

    beforeEach(() => {
      db = createTestDb();
      repo = new SessionRepository(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should findOrCreate a new session', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user1' };
      const session = await repo.findOrCreate(key);

      expect(session.channel).toBe('test');
      expect(session.type).toBe('private');
      expect(session.chatId).toBe('user1');
      expect(session.id).toBeDefined();
    });

    it('should return existing session on findOrCreate with same key', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user1' };
      const session1 = await repo.findOrCreate(key);
      const session2 = await repo.findOrCreate(key);

      expect(session1.id).toBe(session2.id);
    });

    it('should find a session by key', async () => {
      const key: SessionKey = { channel: 'test', type: 'private', chatId: 'user2' };
      await repo.findOrCreate(key);

      const found = await repo.findByKey(key);
      expect(found).not.toBeNull();
      expect(found!.chatId).toBe('user2');
    });

    it('should return null for non-existent session', async () => {
      const result = await repo.findByKey({ channel: 'nope', type: 'private', chatId: 'nobody' });
      expect(result).toBeNull();
    });
  });

  // ─── MessageRepository ──────────────────────────────────────────

  describe('MessageRepository', () => {
    let db: DatabaseSync;
    let msgRepo: MessageRepository;
    let sessionId: string;

    beforeEach(async () => {
      db = createTestDb();
      msgRepo = new MessageRepository(db);
      const session = await new SessionRepository(db).findOrCreate({
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

      await msgRepo.save(sessionId, userMsg);
      await msgRepo.save(sessionId, asstMsg);

      const history = await msgRepo.loadHistory(sessionId);
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
      expect(history[1].role).toBe('assistant');
      expect(history[1].content).toBe('Hi there');
    });

    it('should clear history', async () => {
      await msgRepo.clearHistory(sessionId);
      const history = await msgRepo.loadHistory(sessionId);
      expect(history.length).toBe(0);
    });

    it('should replace history with summary', async () => {
      await msgRepo.save(sessionId, { role: 'user', content: 'Long conversation...' });
      await msgRepo.save(sessionId, { role: 'assistant', content: 'Response...' });
      await msgRepo.save(sessionId, { role: 'user', content: 'More...' });

      await msgRepo.replaceWithSummary(sessionId, 'Summary of conversation');

      const history = await msgRepo.loadHistory(sessionId);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        role: 'assistant',
        content: 'Summary of conversation',
      });
    });

    it('should roll back summary replacement when insert fails', async () => {
      const failingSession = await new SessionRepository(db).findOrCreate({
        channel: 'msgtest',
        type: 'group',
        chatId: 'rollback-room',
      });

      await msgRepo.save(failingSession.id, { role: 'user', content: 'Original question' });
      await msgRepo.save(failingSession.id, { role: 'assistant', content: 'Original answer' });

      db.exec(`
        CREATE TRIGGER fail_message_summary_insert
        BEFORE INSERT ON messages
        WHEN NEW.session_id = '${failingSession.id}' AND NEW.content = 'BROKEN_SUMMARY'
        BEGIN
          SELECT RAISE(FAIL, 'summary insert failed');
        END;
      `);

      await expect(msgRepo.replaceWithSummary(failingSession.id, 'BROKEN_SUMMARY')).rejects.toThrow(
        'summary insert failed',
      );

      const history = await msgRepo.loadHistory(failingSession.id);
      expect(history).toHaveLength(2);
      expect(history.map(({ role, content }) => ({ role, content }))).toEqual([
        { role: 'user', content: 'Original question' },
        { role: 'assistant', content: 'Original answer' },
      ]);
    });
  });

  // ─── RoleBindingRepository ──────────────────────────────────────

  describe('RoleBindingRepository', () => {
    let db: DatabaseSync;
    let roleRepo: RoleBindingRepository;
    let sessionId: string;

    beforeEach(async () => {
      db = createTestDb();
      roleRepo = new RoleBindingRepository(db);
      const session = await new SessionRepository(db).findOrCreate({
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
      const result = await roleRepo.getActiveRole(sessionId);
      expect(result).toBeNull();
    });

    it('should set and get active role', async () => {
      await roleRepo.setActiveRole(sessionId, 'default');
      const roleId = await roleRepo.getActiveRole(sessionId);
      expect(roleId).toBe('default');
    });

    it('should change active role', async () => {
      await roleRepo.setActiveRole(sessionId, 'researcher');
      const roleId = await roleRepo.getActiveRole(sessionId);
      expect(roleId).toBe('researcher');
    });
  });

  // ─── CronJobRepository ──────────────────────────────────────────

  describe('CronJobRepository', () => {
    let db: DatabaseSync;
    let jobRepo: CronJobRepository;

    beforeEach(() => {
      db = createTestDb();
      jobRepo = new CronJobRepository(db);
    });

    afterEach(() => {
      db.close();
    });

    it('should create a cron job', async () => {
      const key: SessionKey = { channel: 'cron', type: 'private', chatId: 'cronuser' };
      const id = await jobRepo.create({
        scheduleType: 'daily',
        scheduleValue: '09:00',
        prompt: 'Good morning!',
        sessionKey: key,
        nextRun: new Date('2026-01-01T09:00:00Z'),
      });

      expect(id).toBeDefined();

      const job = await jobRepo.findById(id);
      expect(job).not.toBeNull();
      expect(job!.scheduleType).toBe('daily');
      expect(job!.prompt).toBe('Good morning!');
    });

    it('should list all jobs', async () => {
      const firstId = await jobRepo.create({
        scheduleType: 'daily',
        scheduleValue: '09:00',
        prompt: 'Morning check',
        sessionKey: { channel: 'cron', type: 'private', chatId: 'list-user-1' },
        nextRun: new Date('2026-01-01T09:00:00Z'),
      });
      const secondId = await jobRepo.create({
        scheduleType: 'interval',
        scheduleValue: '30',
        prompt: 'Status check',
        sessionKey: { channel: 'cron', type: 'private', chatId: 'list-user-2' },
        nextRun: new Date('2026-01-01T09:30:00Z'),
      });

      const jobs = await jobRepo.findAll();

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.id)).toEqual([firstId, secondId]);
    });

    it('should delete a job', async () => {
      const key: SessionKey = { channel: 'cron2', type: 'private', chatId: 'cronuser2' };
      const id = await jobRepo.create({
        scheduleType: 'once',
        scheduleValue: '2026-12-25T00:00:00Z',
        prompt: 'Merry Christmas!',
        sessionKey: key,
        nextRun: new Date('2026-12-25T00:00:00Z'),
      });

      const deleted = await jobRepo.delete(id);
      expect(deleted).toBe(true);

      const job = await jobRepo.findById(id);
      expect(job).toBeNull();
    });

    it('should update next_run', async () => {
      const key: SessionKey = { channel: 'cron3', type: 'private', chatId: 'cronuser3' };
      const id = await jobRepo.create({
        scheduleType: 'interval',
        scheduleValue: '30',
        prompt: 'Check status',
        sessionKey: key,
        nextRun: new Date('2026-06-01T00:00:00Z'),
      });

      const newDate = new Date('2026-06-01T00:30:00Z');
      await jobRepo.updateNextRun(id, newDate);

      const job = await jobRepo.findById(id);
      expect(job!.nextRun).toBe(newDate.toISOString());
    });
  });

  // ─── CronRunRepository ──────────────────────────────────────────

  describe('CronRunRepository', () => {
    let db: DatabaseSync;
    let runRepo: CronRunRepository;
    let jobRepo: CronJobRepository;
    let jobId: string;

    beforeEach(async () => {
      db = createTestDb();
      runRepo = new CronRunRepository(db);
      jobRepo = new CronJobRepository(db);

      const key: SessionKey = { channel: 'runtest', type: 'private', chatId: 'runuser' };
      jobId = await jobRepo.create({
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
      const runId = await runRepo.create({ jobId });
      expect(runId).toBeDefined();

      const running = await runRepo.findRunning();
      expect(running).toHaveLength(1);
      expect(running[0]).toMatchObject({ id: runId, jobId, status: 'running' });
    });

    it('should mark a run as completed', async () => {
      const runId = await runRepo.create({ jobId });
      await runRepo.markCompleted(runId, 'Task completed successfully');

      const running = await runRepo.findRunning();
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
      const runId = await runRepo.create({ jobId });
      await runRepo.markFailed(runId, 'Something went wrong');

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
      const runId1 = await runRepo.create({ jobId });
      const runId2 = await runRepo.create({ jobId });

      await runRepo.markAbandoned([runId1, runId2]);

      const running = await runRepo.findRunning();
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
      const runId1 = await runRepo.create({ jobId });
      const runId2 = await runRepo.create({ jobId });

      db.exec(`
        CREATE TRIGGER fail_cron_run_abandon_update
        BEFORE UPDATE ON cron_runs
        WHEN NEW.id = '${runId2}' AND NEW.status = 'abandoned'
        BEGIN
          SELECT RAISE(FAIL, 'abandon update failed');
        END;
      `);

      await expect(runRepo.markAbandoned([runId1, runId2])).rejects.toThrow(
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
