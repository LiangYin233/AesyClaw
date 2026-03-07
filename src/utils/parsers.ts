/**
 * Parsing Utilities
 *
 * Consolidated parsing functions used across the application.
 */

/**
 * Parse a target string into chat ID and message type
 * Format: "private:123456" or "group:789012"
 */
export function parseTarget(to: string): { chatId: string; messageType: 'private' | 'group' } | null {
  const match = to.match(/^(private|group):(.+)$/);
  if (!match) return null;
  return {
    chatId: match[2],
    messageType: match[1] as 'private' | 'group'
  };
}

/**
 * Parse an interval string into milliseconds
 * Supported formats: "30s", "5m", "2h", "1d"
 */
export function parseInterval(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

/**
 * Parse a session key into its components
 * Format: "channel:chatId" or "channel:chatId:uuid"
 */
export function parseSessionKey(key: string): { channel: string; chatId: string; uuid?: string } {
  const parts = key.split(':');
  if (parts.length >= 3) {
    return { channel: parts[0], chatId: parts[1], uuid: parts[2] };
  }
  return { channel: parts[0], chatId: parts[1] };
}
