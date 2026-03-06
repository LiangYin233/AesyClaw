import { describe, it, expect, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/SessionManager';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { rmSync } from 'fs';

const testDir = join(tmpdir(), `aesyclaw-test-${randomUUID().slice(0, 8)}`);

describe('SessionManager - Pure Functions', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(testDir, 100);
  });

  afterEach(async () => {
    await manager.close();
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  describe('createSessionKey', () => {
    it('should create key without uuid', () => {
      expect(manager.createSessionKey('onebot', 'chat1')).toBe('onebot:chat1');
    });

    it('should create key with uuid', () => {
      expect(manager.createSessionKey('onebot', 'chat1', 'abc123')).toBe('onebot:chat1:abc123');
    });
  });

  describe('parseSessionKey', () => {
    it('should parse key without uuid', () => {
      expect(manager.parseSessionKey('onebot:chat1')).toEqual({
        channel: 'onebot',
        chatId: 'chat1'
      });
    });

    it('should parse key with uuid', () => {
      expect(manager.parseSessionKey('onebot:chat1:abc123')).toEqual({
        channel: 'onebot',
        chatId: 'chat1',
        uuid: 'abc123'
      });
    });

    it('should handle keys with more than 3 parts', () => {
      const result = manager.parseSessionKey('onebot:chat1:abc:extra');
      expect(result.channel).toBe('onebot');
      expect(result.chatId).toBe('chat1');
      expect(result.uuid).toBe('abc');
    });
  });

  describe('createNewSession', () => {
    it('should create a new session key with uuid', () => {
      const key = manager.createNewSession('onebot', 'chat1');
      expect(key).toMatch(/^onebot:chat1:[a-f0-9]{8}$/);
    });

    it('should create unique keys', () => {
      const key1 = manager.createNewSession('onebot', 'chat1');
      const key2 = manager.createNewSession('onebot', 'chat1');
      expect(key1).not.toBe(key2);
    });
  });

  describe('getOrCreate and addMessage', () => {
    it('should create and retrieve a session', async () => {
      await manager.ready();
      const session = await manager.getOrCreate('test:chat1');
      expect(session.key).toBe('test:chat1');
      expect(session.channel).toBe('test');
      expect(session.chatId).toBe('chat1');
      expect(session.messages).toHaveLength(0);
    });

    it('should return existing session on second call', async () => {
      await manager.ready();
      const s1 = await manager.getOrCreate('test:chat1');
      const s2 = await manager.getOrCreate('test:chat1');
      expect(s1).toBe(s2);
    });

    it('should add messages to a session', async () => {
      await manager.ready();
      await manager.addMessage('test:chat1', 'user', 'hello');
      await manager.addMessage('test:chat1', 'assistant', 'hi');
      const session = await manager.getOrCreate('test:chat1');
      expect(session.messages).toHaveLength(2);
      expect(session.messages[0].role).toBe('user');
      expect(session.messages[1].role).toBe('assistant');
    });
  });

  describe('list / count / delete', () => {
    it('should list and count sessions', async () => {
      await manager.ready();
      await manager.getOrCreate('test:chat1');
      await manager.getOrCreate('test:chat2');
      expect(manager.count()).toBe(2);
      expect(manager.list()).toHaveLength(2);
    });

    it('should delete a session', async () => {
      await manager.ready();
      await manager.getOrCreate('test:chat1');
      await manager.delete('test:chat1');
      expect(manager.count()).toBe(0);
    });
  });
});
