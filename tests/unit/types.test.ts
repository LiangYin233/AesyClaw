import { describe, it, expect } from 'vitest';
import type { InboundMessage, OutboundMessage, LLMMessage, ToolCall, ToolDefinition } from '../../src/types';

describe('Types', () => {
  describe('InboundMessage', () => {
    it('should have required fields', () => {
      const msg: InboundMessage = {
        channel: 'onebot',
        senderId: '12345',
        chatId: '67890',
        content: 'test message',
        timestamp: new Date()
      };

      expect(msg.channel).toBe('onebot');
      expect(msg.senderId).toBe('12345');
      expect(msg.chatId).toBe('67890');
      expect(msg.content).toBe('test message');
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it('should allow optional fields', () => {
      const msg: InboundMessage = {
        channel: 'onebot',
        senderId: '12345',
        chatId: '67890',
        content: 'test',
        timestamp: new Date(),
        messageId: 'msg_001',
        rawEvent: { event: 'test' },
        media: ['image1.jpg'],
        messageType: 'group'
      };

      expect(msg.messageId).toBe('msg_001');
      expect(msg.rawEvent).toEqual({ event: 'test' });
      expect(msg.media).toEqual(['image1.jpg']);
      expect(msg.messageType).toBe('group');
    });
  });

  describe('OutboundMessage', () => {
    it('should have required fields', () => {
      const msg: OutboundMessage = {
        channel: 'onebot',
        chatId: '67890',
        content: 'response message'
      };

      expect(msg.channel).toBe('onebot');
      expect(msg.chatId).toBe('67890');
      expect(msg.content).toBe('response message');
    });

    it('should allow optional fields', () => {
      const msg: OutboundMessage = {
        channel: 'onebot',
        chatId: '67890',
        content: 'response',
        reasoning_content: 'thinking process',
        replyTo: 'msg_001',
        media: ['image.jpg'],
        metadata: { key: 'value' },
        messageType: 'private'
      };

      expect(msg.reasoning_content).toBe('thinking process');
      expect(msg.replyTo).toBe('msg_001');
      expect(msg.media).toEqual(['image.jpg']);
      expect(msg.metadata).toEqual({ key: 'value' });
      expect(msg.messageType).toBe('private');
    });
  });

  describe('LLMMessage', () => {
    it('should support all role types', () => {
      const systemMsg: LLMMessage = { role: 'system', content: 'You are helpful' };
      const userMsg: LLMMessage = { role: 'user', content: 'Hello' };
      const assistantMsg: LLMMessage = { role: 'assistant', content: 'Hi there' };
      const toolMsg: LLMMessage = { role: 'tool', content: 'tool result', toolCallId: 'call_001', name: 'tool_name' };

      expect(systemMsg.role).toBe('system');
      expect(userMsg.role).toBe('user');
      expect(assistantMsg.role).toBe('assistant');
      expect(toolMsg.role).toBe('tool');
    });

    it('should support tool calls', () => {
      const toolCall: ToolCall = {
        id: 'call_123',
        name: 'get_weather',
        arguments: { city: 'Beijing' }
      };

      const msg: LLMMessage = {
        role: 'assistant',
        content: 'Let me check the weather',
        toolCalls: [toolCall]
      };

      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls![0].name).toBe('get_weather');
    });
  });

  describe('ToolDefinition', () => {
    it('should have required fields', () => {
      const tool: ToolDefinition = {
        name: 'search',
        description: 'Search for information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' }
          },
          required: ['query']
        }
      };

      expect(tool.name).toBe('search');
      expect(tool.description).toBe('Search for information');
      expect(tool.parameters).toBeDefined();
    });
  });
});
