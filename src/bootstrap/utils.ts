/**
 * Bootstrap Utilities
 *
 * Utility functions used in the bootstrap process.
 */

/**
 * Parse a target string into channel, chat ID and message type
 * Format: "channel:private:123456" or "channel:group:789012"
 */
export function parseTarget(to: string): { channel: string; chatId: string; messageType: 'private' | 'group' } | null {
  const match = to.match(/^([^:]+):(private|group):(.+)$/);
  if (!match) return null;

  return {
    channel: match[1],
    chatId: match[3],
    messageType: match[2] as 'private' | 'group'
  };
}
