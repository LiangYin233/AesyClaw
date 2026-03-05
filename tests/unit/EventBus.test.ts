import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../../src/bus/EventBus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should be instantiated correctly', () => {
    expect(eventBus).toBeInstanceOf(EventBus);
  });

  describe('publishInbound and consumeInbound', () => {
    it('should publish and consume inbound messages', async () => {
      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'hello',
        timestamp: new Date()
      };

      await eventBus.publishInbound(msg);
      const consumed = await eventBus.consumeInbound();

      expect(consumed.content).toBe('hello');
      expect(consumed.channel).toBe('test');
    });

    it('should emit inbound event when publishing', async () => {
      const callback = vi.fn();
      eventBus.on('inbound', callback);

      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'test',
        timestamp: new Date()
      };

      await eventBus.publishInbound(msg);
      expect(callback).toHaveBeenCalledWith(msg);
    });

    it('should support multiple inbound messages in queue', async () => {
      const msg1 = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'first',
        timestamp: new Date()
      };
      const msg2 = {
        channel: 'test',
        senderId: 'user2',
        chatId: 'chat2',
        content: 'second',
        timestamp: new Date()
      };

      await eventBus.publishInbound(msg1);
      await eventBus.publishInbound(msg2);

      const first = await eventBus.consumeInbound();
      const second = await eventBus.consumeInbound();

      expect(first.content).toBe('first');
      expect(second.content).toBe('second');
    });
  });

  describe('publishOutbound and consumeOutbound', () => {
    it('should publish and consume outbound messages', async () => {
      const msg = {
        channel: 'test',
        chatId: 'chat1',
        content: 'response'
      };

      await eventBus.publishOutbound(msg);
      const consumed = await eventBus.consumeOutbound();

      expect(consumed.content).toBe('response');
      expect(consumed.channel).toBe('test');
    });

    it('should emit outbound event when publishing', async () => {
      const callback = vi.fn();
      eventBus.on('outbound', callback);

      const msg = {
        channel: 'test',
        chatId: 'chat1',
        content: 'test'
      };

      await eventBus.publishOutbound(msg);
      expect(callback).toHaveBeenCalledWith(msg);
    });
  });

  describe('event listeners', () => {
    it('should support once listener', async () => {
      const callback = vi.fn();
      eventBus.once('inbound', callback);

      await eventBus.publishInbound({
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'test',
        timestamp: new Date()
      });

      await eventBus.publishInbound({
        channel: 'test',
        senderId: 'user2',
        chatId: 'chat2',
        content: 'test2',
        timestamp: new Date()
      });

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should support removing listeners', async () => {
      const callback = vi.fn();
      eventBus.on('inbound', callback);
      eventBus.off('inbound', callback);

      await eventBus.publishInbound({
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'test',
        timestamp: new Date()
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('waiter pattern', () => {
    it('should immediately deliver message if waiter exists', async () => {
      const msg = {
        channel: 'test',
        senderId: 'user1',
        chatId: 'chat1',
        content: 'immediate',
        timestamp: new Date()
      };

      // Start consuming (will create a waiter)
      const consumePromise = eventBus.consumeInbound();

      // Publish after a small delay
      setTimeout(() => {
        eventBus.publishInbound(msg);
      }, 10);

      const result = await consumePromise;
      expect(result.content).toBe('immediate');
    });
  });
});
