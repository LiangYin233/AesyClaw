import { describe, it, expect } from 'vitest';
import { parseTarget } from '../../src/bootstrap/ServiceFactory';

describe('parseTarget', () => {
  it('should parse private target', () => {
    expect(parseTarget('private:12345')).toEqual({
      chatId: '12345',
      messageType: 'private'
    });
  });

  it('should parse group target', () => {
    expect(parseTarget('group:67890')).toEqual({
      chatId: '67890',
      messageType: 'group'
    });
  });

  it('should return null for invalid format', () => {
    expect(parseTarget('invalid')).toBeNull();
    expect(parseTarget('')).toBeNull();
    expect(parseTarget('unknown:123')).toBeNull();
  });

  it('should return null for empty chatId (regex requires .+)', () => {
    expect(parseTarget('private:')).toBeNull();
  });

  it('should handle target with special characters in chatId', () => {
    expect(parseTarget('group:abc-123_456')).toEqual({
      chatId: 'abc-123_456',
      messageType: 'group'
    });
  });
});
