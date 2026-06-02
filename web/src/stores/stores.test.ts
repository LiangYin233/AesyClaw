/**
 * Stores 和 Services 基本功能测试
 *
 * 这个文件演示了如何使用新的 Pinia stores 和 API services
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useChatStore } from '../stores/useChatStore';
import { useSessionStore } from '../stores/useSessionStore';
import { useConfigStore } from '../stores/useConfigStore';
import { useRoleStore } from '../stores/useRoleStore';

describe('Pinia Stores', () => {
  beforeEach(() => {
    // 为每个测试创建新的 Pinia 实例
    setActivePinia(createPinia());
  });

  describe('useChatStore', () => {
    it('should initialize with empty state', () => {
      const chatStore = useChatStore();

      expect(chatStore.messages).toBeInstanceOf(Map);
      expect(chatStore.messages.size).toBe(0);
      expect(chatStore.loading).toBe(false);
      expect(chatStore.error).toBeNull();
    });

    it('should add message to session', () => {
      const chatStore = useChatStore();
      const sessionId = 'test-session';
      const message = {
        id: 'msg-1',
        role: 'user' as const,
        content: 'Hello',
        timestamp: Date.now(),
        sessionId,
      };

      chatStore.addMessage(sessionId, message);

      const messages = chatStore.getMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toEqual(message);
    });

    it('should update streaming message', () => {
      const chatStore = useChatStore();
      const sessionId = 'test-session';
      const content = 'Streaming content...';

      chatStore.updateStreamingMessage(sessionId, content);

      expect(chatStore.getStreamingMessage(sessionId)).toBe(content);
    });

    it('should clear messages for session', () => {
      const chatStore = useChatStore();
      const sessionId = 'test-session';

      chatStore.addMessage(sessionId, {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      });

      chatStore.clearMessages(sessionId);

      expect(chatStore.getMessages(sessionId)).toHaveLength(0);
    });
  });

  describe('useSessionStore', () => {
    it('should initialize with empty state', () => {
      const sessionStore = useSessionStore();

      expect(sessionStore.sessions).toEqual([]);
      expect(sessionStore.currentSessionId).toBeNull();
      expect(sessionStore.loading).toBe(false);
      expect(sessionStore.error).toBeNull();
    });

    it('should set current session', () => {
      const sessionStore = useSessionStore();
      const sessionId = 'test-session';

      sessionStore.setCurrentSession(sessionId);

      expect(sessionStore.currentSessionId).toBe(sessionId);
    });

    it('should update session', () => {
      const sessionStore = useSessionStore();
      const session = {
        id: 'session-1',
        channelId: 'channel-1',
        chatType: 'private',
        chatId: 'chat-1',
        activeRoleId: 'default',
        messageCount: 5,
        lastMessageAt: Date.now(),
        createdAt: Date.now(),
      };

      sessionStore.updateSession(session);

      expect(sessionStore.sessions).toHaveLength(1);
      expect(sessionStore.sessions[0]).toEqual(session);
    });
  });

  describe('useConfigStore', () => {
    it('should initialize with empty state', () => {
      const configStore = useConfigStore();

      expect(configStore.config).toEqual({});
      expect(configStore.schema).toBeNull();
      expect(configStore.loading).toBe(false);
      expect(configStore.error).toBeNull();
    });

    it('should update config', () => {
      const configStore = useConfigStore();
      const key = 'testKey';
      const value = 'testValue';

      configStore.updateConfig(key, value);

      expect(configStore.config[key]).toBe(value);
    });

    it('should compute providers', () => {
      const configStore = useConfigStore();
      configStore.config = {
        providers: {
          openai: { apiKey: 'test-key' },
        },
      };

      expect(configStore.providers).toEqual({
        openai: { apiKey: 'test-key' },
      });
    });
  });

  describe('useRoleStore', () => {
    it('should initialize with empty state', () => {
      const roleStore = useRoleStore();

      expect(roleStore.roles).toEqual([]);
      expect(roleStore.tools).toEqual([]);
      expect(roleStore.skills).toEqual([]);
      expect(roleStore.loading).toBe(false);
      expect(roleStore.error).toBeNull();
    });

    it('should compute enabled roles', () => {
      const roleStore = useRoleStore();
      roleStore.roles = [
        {
          id: 'role-1',
          description: 'Role 1',
          systemPrompt: 'Prompt 1',
          toolPermission: { mode: 'allowlist', list: [] },
          skills: [],
          enabled: true,
        },
        {
          id: 'role-2',
          description: 'Role 2',
          systemPrompt: 'Prompt 2',
          toolPermission: { mode: 'allowlist', list: [] },
          skills: [],
          enabled: false,
        },
      ];

      expect(roleStore.enabledRoles).toHaveLength(1);
      expect(roleStore.enabledRoles[0]?.id).toBe('role-1');
      expect(roleStore.disabledRoles).toHaveLength(1);
      expect(roleStore.disabledRoles[0]?.id).toBe('role-2');
    });

    it('should get role by id', () => {
      const roleStore = useRoleStore();
      const role = {
        id: 'test-role',
        description: 'Test Role',
        systemPrompt: 'Test Prompt',
        toolPermission: { mode: 'allowlist' as const, list: [] },
        skills: [],
        enabled: true,
      };
      roleStore.roles = [role];

      const found = roleStore.getRoleById('test-role');

      expect(found).toEqual(role);
    });
  });
});
