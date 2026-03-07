/**
 * Bootstrap Utilities
 *
 * Utility functions used in the bootstrap process.
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
